# Product analytics

Prometeu records two kinds of product evidence: identified control activations
and explicit feature use. The decision is in
[ADR 0093](../decisions/0093-anonymous-product-analytics.md). Execution diagnostics
remain in [local telemetry](telemetry.md), which never leaves the machine.

## Tracking plan and ownership

- [`analytics::Event`](../../src-tauri/src/analytics.rs) is the native allowlist.
- [`AnalyticsEvent`](../../src/analytics.ts) and
  [`FeatureEvent`](../../src/analytics-events.ts) type frontend emissions.
- The [generated catalog](product-analytics-catalog.json) lists authored control
  identities, their source files, composed metadata expressions and every
  feature event's closed fields. Run `node scripts/analytics-catalog.mjs` after
  changing the vocabulary or control metadata; CI checks that it stays current.
- The [coverage map](../quality/product-analytics-coverage.md) connects product
  modules to evidence, boundaries and verification.

Product owns the question and interpretation; the feature owner maintains the
trigger and its tests. Names describe facts in lowercase `object_verb` form.
Variations use closed properties, not customer-derived event names. New fields
must be enums or booleans; control identities are identifier tokens authored in
code. Never send user content, filenames, paths, URLs, names, record IDs, search
queries, commands, credentials, prompts, output or error messages.

## Named interactions

`ui_clicked {control, target, area}` records activation of an identified
Prometeu control. `target` and `area` are required nonempty tokens. The token
shape is 1–80 ASCII letters, digits, dots, underscores or hyphens. Rust rejects
nulls, empty strings, sentences, paths and URLs.

`target` comes only from explicit `data-track`, `data-t-title` or `data-t`
metadata. The latter two use the authored key itself; there is no reverse lookup
of translated labels and no fallback to element IDs, visible text, CSS paths,
positions, `unknown` or generic control names. Repeated data rows share an action
identity such as `rail.workspace`; their names and IDs are not sent.

`area` comes from explicit `data-track-area` metadata on the control or an
ancestor. Shared menus, dialogs and pickers preserve the opener's area when
mounting outside its DOM tree. Screen hosts can supply a more specific area.
Changing a control's action with its state requires the corresponding target.
Containers use area metadata, not a click target for their entire contents.

The single listener observes buttons, links, tabs, menu items, options,
checkboxes, radios, selectors, fields, disclosures and explicitly marked custom
controls. Nested controls resolve to the closest control. Authored
`data-track-double-click` and `data-track-context-menu` record those distinct
actions. Keyboard activation can generate a DOM click. Owned native-menu
callbacks also record their authored action key with `area: native_menu`;
these callbacks do not distinguish a menu click from its accelerator.

Missing or malformed metadata does not produce a null or fabricated event.
It marks the element with `data-track-missing`, dispatches the local
`analytics-unidentified` diagnostic and warns in development.
`unidentifiedControls` inspects rendered controls even before activation.
Disabled controls are ineligible until enabled; hidden enabled controls remain
inspectable. Coverage checks must expose and fix these gaps; dropping unidentified events
alone is not evidence of complete coverage. These diagnostics never leave the
machine. Arbitrary content inside embedded websites/PDF viewers and OS-owned
menu actions are outside this listener's boundary.

Shared UI components carry authored metadata without emitting analytics events. They do not
import the analytics service, IPC or app controllers. Optional tracking arguments
preserve existing consumers; feature owners must supply metadata for the desktop.

## Feature-use vocabulary

Feature events record the agreed action at its shared application path, not a
second handler on its button. Mouse, keyboard, paste/drop, and accepted remote
or MCP paths are covered where the operation is shared. Render, background refresh,
polling, token streams and process completion do not count as feature use.

The generated catalog defines all property types. This table defines meaning:

| Event(s) | What is recorded |
| --- | --- |
| `app_opened` | Desktop process start; not daily activity |
| `screen_viewed` | A change of visible screen |
| `workspace_created` | Workspace creation before preparation, including delegation; `provider`, `is_worktree` |
| `conversation_created` | An additional conversation tab, excluding the workspace's first conversation; `provider` |
| `project_action_used` | New registration/addition, creation of a local Git project, removal, changed order/group or creation of script configuration |
| `workspace_action_used` | Changed stage, rename, pin, finish, archive, restore, remove or cleanup; manual read/unread actions are emitted by the UI, not automatic notification updates |
| `desk_layout_changed` | A completed visibility, order or size change |
| `conversation_opened` | Explicit workspace-tab activation or revealing a desk conversation |
| `conversation_resumed` | Continue sends its command successfully; not model execution |
| `attachment_added`, `context_attached` | Adding new attachment files or structured draft context, including selected file references; not free-text inspection |
| `output_copied` | Successful copying of a message or code block |
| `request_answered`, `approval_submitted` | Accepted local or relayed response to a request; the answer itself is excluded |
| `model_selection_changed`, `effort_changed`, `model_favorite_changed` | Explicit picker selection or favorite change; not automatic catalog refresh |
| `usage_summary_viewed`, `quota_viewed`, `machine_panel_opened` | Opening the respective panel, not its periodic updates |
| `file_opened` | Explicit viewer opening after successful reading, by closed viewer kind; refreshing or selecting the already active file does not count |
| `file_search_used` | Opening search in the file viewer |
| `file_operation_completed` | A successful save, create, rename, move, trash or restore operation; no path or contents |
| `diff_viewed`, `git_comparison_opened` | Explicit entry into a diff or comparison view, not status polling |
| `git_operation_completed` | A successful stage, unstage, commit, fetch, pull, push, publish, discard or conflict resolution |
| `review_note_created`, `review_notes_sent` | Persisting a new review note or marking a sent batch submitted locally; sending does not prove provider receipt or completed review |
| `terminal_opened` | Spawning a new interactive terminal; reattaching an existing PTY is excluded |
| `project_script_started`, `project_script_stopped` | Starting a new Setup/Run process or explicitly stopping a live one; setup includes automatic workspace preparation |
| `preview_opened`, `browser_context_attached`, `preview_capture_created` | Opening preview from another view, attaching inspected context or creating a capture; no URL, HTML or image is sent |
| `dictation_started`, `dictation_text_inserted` | Recognition starts, then the first final transcript insertion per dictation session; interim text is not counted or transmitted |
| `action_used` | Expanding a prompt action into the draft or successfully starting an agent action |
| `settings_section_viewed`, `settings_search_used` | Entering a settings page or beginning a nonempty settings search; not every redraw or keystroke |
| `preference_changed` | An explicit change to one of the allowed preference categories |
| `resource_action_used` | Resource save/remove/install/update/copy/share or an explicit authentication/check/discovery/generation operation; a check may report a failed probe, and generation records job acceptance |
| `resource_selection_changed` | Changing resource defaults, global selection or a workspace selection; enabling does not prove resource execution |
| `integration_action_used` | Integration setup actions; GitHub connect requires returned connected status, and Cloud connect requires a completed login poll |
| `provider_account_action_used` | Login start/cancellation, account selection or removal; login start is not successful authentication |
| `action_configuration_changed` | Saving/removing a command, profile or override configuration |
| `issue_action_used` | Claiming an issue, opening its source, opening an existing workspace or preparing the creation launcher; preparation is not workspace creation |
| `notification_action_used` | Explicit inbox/island actions, reading and navigation; notification delivery is excluded |
| `collaboration_action_used` | Explicit organization, sharing, permissions, pending-input and comment actions through the desktop shell; no participant identifiers |
| `usage_history_action_used` | The history panel becoming visible, explicit refresh/filter, successful export or clearing local history; no history records are uploaded |
| `update_action_used`, `release_notes_viewed` | Explicit update actions or opening release notes; restart is an intent recorded before relaunch and may be lost at shutdown |
| `feedback_action_used` | Opening the feedback panel/public issue form or successful private submission; opening GitHub does not prove an issue was sent |
| `trust_decision_made` | An explicit project-resource trust decision |
| `delegation_action_used` | Successful authorized MCP operations, with internal/external client category; retries count tool use, not unique new agents |

Finishing a workspace also archives it; those are distinct facts, so do not sum
them as independent workspaces. A control activation and its feature event are
also separate evidence about the same interaction. Avoid summing event counts
across a workflow to estimate people or unique operations. History `view` is
visible-panel exposure, once per settings entry/page transition; refresh, filter,
export and clear distinguish explicit interaction.

The unshipped conversation-runtime experiment (`message_accepted`,
`turn_finished`, activity flags) is not part of this vocabulary. Existing local
execution telemetry remains unchanged.

## Measurement and interpretation

The unit is an observed installation, not an identified person. For feature
adoption, count installations using the feature among eligible active
installations on versions and platforms that emit the necessary facts. Follow
recurrence across days/weeks and concentration of activity. An app can stay open
for days; process starts are not an activity denominator.

Availability, discovery, configuration and use are different. Installing or
enabling a plugin does not prove a provider invoked it. A rarely used feature
may be important to a small group. Absence from a chart can reflect missing
instrumentation, unsupported shells or delivery loss. Removing features needs
verified coverage, sufficient observation and qualitative context.

Existing dashboard descriptions distinguish initializations, reopens,
additional conversations and captured controls. Old queries and history remain
unchanged. New adoption dashboards require a release and verified ingestion;
this PR does not manufacture new data from old clicks.

## Payload, privacy and delivery

Events are sent in HTTPS batches to `https://us.i.posthog.com/batch/`. Every
payload contains the event's allowed fields and fixed metadata:
`analytics_version: 2`, app version, OS, architecture, `$lib: prometeu`,
`$process_person_profile: false`, and `$geoip_disable: true`. No PostHog JS SDK,
session replay, DOM upload or local telemetry synchronization is introduced.

Identity is a random UUID stored in `<root>/analytics-id`. It is pseudonymous:
events from an installation can be linked, but no account or workspace identity
is sent. The PostHog US project must discard client IP data. There is currently
no opt-in/opt-out control; vocabulary expansion must revisit that decision.

The top-level `offset` is monotonic elapsed milliseconds from capture to batch
construction. PostHog subtracts it from server receipt time, preserving spacing
within a batch without trusting the client clock. Network delay still affects
absolute time; it is not a latency measurement.

One thread batches for five seconds after the first event and uses a ten-second
request timeout. Failed deliveries and batches waiting at exit are dropped.
There is no offline queue or retry. Tracking never blocks or fails a feature.
Only builds compiled with a nonempty `PROMETEU_POSTHOG_KEY` send events.

| Shell | Coverage |
| --- | --- |
| macOS and Linux desktop | Releases with the ingestion key |
| Native Windows / WSL | No product-event transport in this delivery |
| Browser mock | No upload; used for control and behavior verification |
| Mobile companion | No product-event transport in this delivery |

## Compatibility and verification

Version 2 preserves the four existing lifecycle/navigation event meanings,
adds feature events, and requires explicit non-null click metadata. Historic
version-1 clicks, including nulls and ambiguous translation-derived targets,
remain in PostHog; they are not rewritten, backfilled or directly equivalent to
new control series. Native and frontend contracts ship together; no persisted
board, transcript or relay format changes.

[Native tests](../../src-tauri/src/analytics.rs) reject null click identities,
unregistered events and invalid closed values, exclude content, and preserve
timing offsets. Shared [fixtures](../../src-tauri/tests/fixtures/product-analytics.json)
and [TypeScript parity tests](../../src/analytics-events.test.ts) exercise the
same event schemas. [Click tests](../../src/analytics.test.ts) cover explicit
metadata and diagnostics. [Real-DOM checks](../../scripts/check-analytics.mjs)
exercise fields, choices, menus, dialogs, pickers and feedback, including controls
that were never clicked. The [shared E2E fixture](../../e2e/fixtures.ts) rejects
missing metadata on controls activated by existing browser scenarios.
Feature tests cover successful/failed actions, review
persistence, dictation and configuration flows. See the coverage map for scope.

Run `npm run analytics:check` and the closest feature tests during development;
run `npm run check` for changes spanning modules. These tests verify local
contracts and capture behavior, not successful delivery to a live PostHog project.
