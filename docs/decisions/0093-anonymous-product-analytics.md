# ADR 0093 — Anonymous product analytics in PostHog

Date: 2026-10-23
Status: Accepted

## Context

We do not know which features people use. The local telemetry in
[ADR 0059](0059-local-telemetry-foundation.md) measures execution (turns, usage,
time, PRs) and never leaves the machine. Product questions need a different
dataset: feature events from many installations, with funnels and retention, in
the style of Mixpanel or PostHog. Three constraints are fixed: the data is
anonymous, transport is secure, and no customer data (code, prompts, paths,
names, output) is sent.

## Options considered

1. **Reuse the local telemetry store and sync it.** It is already typed, but its
   events carry per-turn measurements and opaque workspace identities designed for
   local insight. Uploading it would widen ADR 0059's privacy boundary.
2. **Daily aggregated counters to our own Worker.** The most private option, but
   counters without an installation identity cannot answer funnel or retention
   questions.
3. **Aptabase.** Anonymous by design, but its dashboards do not offer
   PostHog-level funnels and cohorts.
4. **PostHog Cloud with events sent from Rust.** Funnels, retention and
   dashboards without operating infrastructure.

## Decision

Use option 4. The [contract](../contracts/product-analytics.md) lists the events
and payload. The core choices are:

- Rust owns the vocabulary: `analytics::Event` is a closed enum. The webview
  calls `analytics_track` with a typed event; anything outside the enum fails to
  deserialize. Fields are closed enums, booleans or identifier tokens whose shape
  (ASCII letters, digits, `.`, `_`, `-`) cannot hold a sentence, path or URL.
- Clicks are captured generically, not one event per feature. One listener in
  the webview records every click on a control as the i18n key of its label and
  the static `index.html` region around it. A label becomes a key only by
  exactly matching a catalog translation, so visible text never leaves; new UI is
  covered without annotation. A few typed events cover outcomes a click cannot
  show, such as a workspace actually being created, plus screen views. Names
  follow one `object_verb` convention and the contract is the tracking plan;
  readable names for specific clicks are PostHog Actions, not new events.
- Events leave from Rust over HTTPS to the PostHog US ingestion host, where the
  project lives. No PostHog JavaScript SDK runs in the webview: its autocapture
  sends element text, and session replay and heatmaps read the DOM, which holds
  code and prompts.
- Identity is a random UUID per installation in `<root>/analytics-id`, unrelated
  to accounts, devices, paths or the local telemetry identities. Events set
  `$process_person_profile: false` and `$geoip_disable: true`. The PostHog project
  must also discard client IP addresses.
- The layer is decoupled: callers emit one fire-and-forget `track` call, which
  never blocks or fails a feature. A single background thread batches events in
  5-second windows and posts them. Failed deliveries are dropped without retry.
- Only builds compiled with `PROMETEU_POSTHOG_KEY` send events. Development,
  tests, forks and local builds send nothing. Release CI supplies the key from a
  repository variable; a PostHog project key is write-only and public by design.
- This first delivery has no opt-in or opt-out control. That is a product decision
  revisited before the vocabulary grows beyond feature usage.

## Consequences

PostHog becomes an external recipient of product metadata. The installation ID
makes events pseudonymous, not strictly anonymous: events from the same
installation can be linked to each other, though not to a person. Keeping
properties to identifiers we author is what keeps that link harmless; every new
event goes through the contract and review.

Generic clicks multiply volume. PostHog's free tier allows one million events a
month, so heavy use from a few hundred installations can exceed it; the project
needs a billing limit. Clicks show intent, not success, and controls whose label
is dynamic (workspace rows, file names, parameterized text) arrive with only
their region.

There is no offline queue, so coverage drops while offline or when PostHog is
unreachable. The Windows WSL runtime does not implement `analytics_track`, so
native Windows builds send no events in this delivery. The browser mock ignores
events.

The local telemetry of ADR 0059 is unchanged and remains local.

## Evidence

- [Vocabulary, payload and delivery](../../src-tauri/src/analytics.rs), with tests
  for the payload's key allowlist, rejection of unknown events, normalization of
  unknown provider text and rejection of non-identifier click tokens.
- [Click and screen capture](../../src/analytics.ts), with
  [tests](../../src/analytics.test.ts) that only catalog keys become targets,
  and the typed command in [`src/ipc.ts`](../../src/ipc.ts); the existing IPC
  parity test checks native registration and the browser handler.
- Call sites: app start in [`main.rs`](../../src-tauri/src/main.rs), workspace and
  conversation creation in [`session.rs`](../../src-tauri/src/session.rs), and
  click capture and screen changes in [`src/main.ts`](../../src/main.ts).
