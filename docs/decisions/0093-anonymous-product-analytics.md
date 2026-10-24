# ADR 0093 — Product analytics in PostHog

Date: 2026-10-23
Status: Accepted

## Context

Product decisions need evidence about feature adoption and repeated use. Local
[execution telemetry](0059-local-telemetry-foundation.md) answers operational
questions and stays on the machine. Clicks inferred from translated labels can
have a null target or identify the wrong feature; a click also cannot establish
that the corresponding operation happened.

The product needs both named interactions and feature-use events. Customer
content must not be collected. The [contract](../contracts/product-analytics.md)
contains the tracking plan and delivery rules; the
[coverage map](../quality/product-analytics-coverage.md) inventories modules.

## Options considered

1. **Upload local telemetry.** It contains execution detail and local identities
   intended for private analysis. Uploading would widen its privacy boundary and
   would not directly answer which UI features are used.
2. **Send daily aggregate counters to our Worker.** This offers less individual
   linkage but cannot support installation-level recurrence and funnels.
3. **Use a minimal analytics service.** This reduces setup but limits cohort and
   exploration capabilities needed for feature decisions.
4. **Send a closed vocabulary from Rust to PostHog.** This supports product
   analysis without operating another service or exposing the webview DOM.

## Decision

Use option 4, with two categories of evidence:

- **Named control activations:** one `ui_clicked` vocabulary with required,
  authored `target` and `area`. Use explicit tracking metadata or explicit i18n
  key metadata; never infer a key from translated text. Menus and dialogs carry
  the original area into their portals. A repeated row identifies the action,
  not the customer's item. Owned native-menu callbacks share the same model.
- **Feature use:** typed events emitted from explicit application operations,
  independent of the button that starts them. Successful mutations are observed
  at the native use case; presentations record explicit opening, selection and
  copying where those actions are owned. Shared keyboard, paste/drop, remote and
  MCP paths are covered where applicable. Configuration and execution remain
  different facts. No product event observes model turn completion or uploads
  local execution telemetry.

Rust validates the event vocabulary and closed fields before delivery.
TypeScript types and shared test fixtures protect parity. Control identifiers
have a restrictive token shape; no prompts, code, filenames, paths, URLs, user
names, search text, commands, output or error strings are allowed. Shared UI
components carry metadata but do not import app controllers, analytics or IPC.

A [generated source catalog](../contracts/product-analytics-catalog.json) records
control identities, source locations, composed expressions and feature event
schemas. Runtime checks inspect controls even before a click. Unidentified
controls produce local diagnostics and no analytics event. Coverage checks must
fix these gaps rather than replacing them with `unknown` or claiming complete
coverage from an empty null bucket. Disabled controls are ineligible until
activated; hidden but enabled controls are still checked.

Events leave through HTTPS to the US PostHog project. There is no PostHog JS SDK,
session replay, heatmap or DOM upload. A UUID stored in `<root>/analytics-id`
identifies an installation, independently of accounts and local telemetry IDs.
Person profiles and geolocation are disabled; the project must discard client
IP data. This is pseudonymous metadata, not an identified-user dataset.

Tracking is fire-and-forget and cannot fail a feature. One thread collects
five-second batches; failed requests and pending shutdown batches are dropped.
There is no retry or offline queue. Only builds compiled with a nonempty
`PROMETEU_POSTHOG_KEY` send events. Windows/WSL, mobile and the browser mock do not
have a product-event transport in this delivery.

Version 2 adds explicit feature events, fixed `analytics_version: 2`, and a
monotonic top-level `offset` so PostHog preserves spacing within a batch without
trusting the client clock. Network delay still shifts absolute time. Existing
lifecycle/navigation meanings remain; old click series with null or inferred
identities are historical data, not backfilled into the new catalog.

The current delivery has no opt-in or opt-out control. Revisit that decision
before widening the vocabulary beyond content-free feature use. The existing
local telemetry store and its deletion semantics remain independent.

## Consequences

The team can distinguish finding/activating a control from actually using its
feature. Stable identities require explicit maintenance when actions or surfaces
change, and catalog checks become part of contribution validation. The source
catalog does not prove every dynamic state has been exercised; runtime and
feature tests remain necessary.

Granularity has a cost. New events need a product question, exact trigger,
allowed properties, eligible audience, coverage and verification. Prefer
properties for variants of one operation and avoid recording polling, every
keystroke, every resize pixel or streams. Do not sum clicks and feature events
as unique operations, or treat app starts as daily activity.

Low observed use is not sufficient to remove a feature. Check availability,
discovery, recurrence, concentrated use, unsupported shells and delivery loss,
then gather qualitative context. Existing PostHog dashboard titles were corrected
without changing their queries; adoption dashboards require released events and
verified ingestion.

## Evidence

- [Typed native vocabulary and payload tests](../../src-tauri/src/analytics.rs),
  [feature schema parity](../../src/analytics-events.test.ts), and
  [shared fixtures](../../src-tauri/tests/fixtures/product-analytics.json).
- [Click capture and diagnostics](../../src/analytics.ts),
  [capture tests](../../src/analytics.test.ts), and
  [real DOM/portal checks](../../scripts/check-analytics.mjs).
- [Catalog generator](../../scripts/analytics-catalog.mjs) and its
  [extraction/staleness test](../../scripts/analytics-catalog.test.mjs).
- Feature tests and observation boundaries listed in the coverage map.
