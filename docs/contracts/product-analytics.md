# Anonymous product analytics

Prometeu sends anonymous feature events to PostHog so we can tell which features
are used. The decision and its trade-offs are in
[ADR 0093](../decisions/0093-anonymous-product-analytics.md). This is separate
from the [local telemetry](telemetry.md), which never leaves the machine.

## Vocabulary

`analytics::Event` in [`src-tauri/src/analytics.rs`](../../src-tauri/src/analytics.rs)
is the source of truth; [`src/analytics.ts`](../../src/analytics.ts) mirrors it.

This document is the tracking plan: every event that exists is in the table.

| Event | Properties | Emitted when |
| --- | --- | --- |
| `app_opened` | none | The desktop app starts |
| `screen_viewed` | `screen` | The visible screen changes |
| `workspace_created` | `provider`, `is_worktree` | A workspace is created, including MCP delegation |
| `conversation_created` | `provider` | Another conversation is opened in an existing workspace |
| `ui_clicked` | `control`, `target`, `area` | Any click on a button, link, menu item, tab, option, checkbox or select |

`provider` is `claude`, `codex`, `antigravity` or `gemini` (the retired value).
Unknown provider text deserializes as `claude`, so it never reaches the payload.
`screen` is `desk`, `settings`, `issues`, `notifications`, `archived`,
`workspace` or `project`; moving between workspaces is not a screen change.

## Naming

- Event names are `object_verb` in lowercase snake_case, with the verb in the
  past tense from a fixed list: `opened`, `viewed`, `created`, `clicked`,
  `archived`, `deleted`. Add a verb to this list before using it.
- Names are static. A variation is a property (`ui_clicked` with a `target`),
  never a new name built from a value.
- Properties are snake_case nouns. Booleans start with `is_` or `has_`.
- A typed event exists only for an outcome a click cannot show: something was
  created, failed or finished, or happened without a click (shortcuts, MCP
  delegation). Interface usage is `ui_clicked`.
- Readable names for specific clicks are PostHog Actions over `ui_clicked`
  filtered by `target`, for example "Settings opened" for `top.settings`. They
  need no code change.

### Clicks

One capture-phase listener in [`src/analytics.ts`](../../src/analytics.ts)
records every click on a control, so new UI is covered without annotation. It
never reads visible text into the event:

- `target` is the control's `data-track` token when it has one, else the i18n
  key of the control's label. The label (`data-t` or
  `data-t-title`, then `aria-label`, `title`, menu label, text) is looked up in
  the active catalog; only an exact match of a parameterless translation
  produces a key. Otherwise `target` is the control's own ID if that ID was in
  `index.html` at startup, else `null`. Workspace names, file names, agent
  output and typed text never match, so they never become a target. Translations
  shared by several keys resolve to the first key in the catalog.
- `data-track` names controls whose label is user data or a parameterized
  translation, which would otherwise send `null`: rail workspaces, groups and
  agents (`rail.*`), file tree rows (`tree.folder`, `tree.file`) and center tabs
  (`tab.conversation`, `tab.file`, `tab.terminal`, `tab.browser`). An element
  with `data-track` counts as a control even when it is not one, so a close
  icon nested in a tab (`tab.close`, `tab.file.close`, …) is told apart from the
  tab itself. The token is a static string we author; never build it from data.
- `area` is `menu` inside a menu, otherwise the nearest ancestor ID present in
  `index.html` at startup (`deskView`, `settingsView`, `tabbar`, `rail` and so
  on), else `null`.
- `control` is one of `button`, `link`, `menuitem`, `tab`, `option`,
  `checkbox` or `input`.

Rust accepts `target` and `area` only as identifier tokens: 1 to 80 ASCII
letters, digits, `.`, `_` or `-`. Sentences, paths and URLs fail to deserialize
even if a caller passes text by mistake.

## Payload

Every event is posted in a batch to `https://us.i.posthog.com/batch/`:

```json
{
  "api_key": "<PROMETEU_POSTHOG_KEY>",
  "batch": [
    {
      "event": "conversation_created",
      "distinct_id": "<random installation UUID>",
      "properties": {
        "provider": "codex",
        "$process_person_profile": false,
        "$geoip_disable": true,
        "$lib": "prometeu",
        "app_version": "0.29.1",
        "os": "macos",
        "arch": "aarch64"
      }
    }
  ]
}
```

No other properties are sent. `distinct_id` is a UUID v4 created at first use
and stored privately in `<root>/analytics-id`; an unreadable file is replaced
with a new one.

## Rules for new events

- Clicks need no new event; follow the naming rules above before adding one.
- An i18n key or `data-track` token used as a click `target` is part of this contract. Renaming it
  starts a new series in PostHog; update the Actions that filter on it.
- Add the variant to the Rust enum and the TypeScript union, add a row to the
  table above, and emit it with a single `track` call at the use case.
- Fields must be closed enums, booleans or identifier tokens we author. Never
  add user content, record IDs, names, paths, titles, URLs, branch names, model
  output or error messages.
- Prefer emitting from the Rust use case every caller goes through.
- `track` is fire-and-forget. Do not await it or branch on its result.

## Delivery and configuration

- One background thread collects events for 5 seconds after the first one, then
  posts the batch with a 10-second timeout. Failures, and a batch still waiting
  when the app quits, are dropped; there is no offline queue.
- Only builds compiled with a non-empty `PROMETEU_POSTHOG_KEY` send events. Release CI reads
  it from the `PROMETEU_POSTHOG_KEY` repository variable; other builds send
  nothing.
- The PostHog project is in the US region; a key from another region is
  rejected silently. **Discard client IP data** must be enabled, because US
  projects record the request IP by default and the client cannot remove it.
- There is no opt-in or opt-out control in this version.

## Coverage

| Shell | Sends events |
| --- | --- |
| macOS and Linux desktop | Yes, release builds with the key |
| Native Windows (WSL runtime) | No; `analytics_track` is unsupported and ignored |
| Browser mock | No; the handler ignores events |
| Mobile shell | No |

## Verification

The tests in [`analytics.rs`](../../src-tauri/src/analytics.rs) check that the
payload contains only the event's fields plus the fixed metadata, that unknown
events are rejected, that extra or unknown values are dropped, and that click
tokens reject sentences, paths and URLs. [`src/analytics.test.ts`](../../src/analytics.test.ts)
checks that only catalog keys become click targets, that captured clicks carry
the right control, target and region, that `data-track` tokens name dynamic
controls and their nested parts, and that repeated screens are not counted. The IPC parity
test in [`src-tauri/tests/mock.rs`](../../src-tauri/tests/mock.rs) covers command
registration.
