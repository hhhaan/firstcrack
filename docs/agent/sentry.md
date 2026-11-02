# Sentry (agent)

**Audience:** coding agents
**Related:** root `AGENTS.md` (Sentry), `src/shared/lib/sentry.ts`, `supabase/functions/_shared/sentry.ts`

Add a report in the same change when a path can fail after the user already did the right thing: save, connect, RPC, edge handler, machine write, process spawn.

Done when that path has exactly one report, tagged with a fixed code, and expected refusals are left to the existing filter.

## Already wired

Do not init a client or add a DSN.

| Runtime | Entry | Capture |
|---------|--------|---------|
| Web | `src/shared/lib/sentry.ts` (import from `main.tsx`). PROD on. DEV only when `VITE_SENTRY_SMOKE=true\|1` | `captureActionable` via the helpers below |
| React Query | `src/shared/lib/createAppQueryClient.ts` | `QueryCache` / `MutationCache` → `reportReactQueryError` |
| React render | `reactRootOptions` in `main.tsx` | Only path for render errors. `ErrorBoundary` does not capture |
| Sidecar | `src-tauri/sidecar/sentry_config.py` | `RoasterManager._capture_hardware_error` |
| Rust | `src-tauri/src/sentry_config.rs` + `tauri_plugin_sentry` | `sentry::capture_message` / `add_breadcrumb` in `lib.rs` |
| Edge | `supabase/functions/_shared/sentry.ts` | No-op without the `SENTRY_DSN` secret |

`beforeSend` / `before_send` is the only scrubber. Do not scrub at the call site.

## Web

Query or mutation — the cache reports it. Set meta and stop:

```ts
meta: { feature: 'history-qc', rpc: 'set_session_charge_weight' }
```

Use `table` instead of `rpc` for a table write. `feature` is a fixed code. `silentError` only hides the toast.

A `catch` that never reaches those caches (file IO, Tauri command, fire-and-forget):

```ts
logger.capture(error, { feature: 'export-csv' });
```

Import `logger` from `@shared/lib/logger`. Keys other than `feature`, `rpc`, and `table` land in extra, not tags.

No second call when the same error already reports: React Query `onError`, React root handler, or sidecar HTTP with `sentryReported` (502/400 included).

Active Roast gas-off diagnostics: search `feature:machine-control "Gas-off feedback was not observed"`.
After an acknowledged heater-zero write, a five-second window without fresh zero Heat feedback
produces one warning and an operator toast. This is an observation window, not a machine failure deadline.
`reason` distinguishes `nonzero_feedback` from `feedback_unavailable`; extra includes the batch,
command ID/sequence, origins, attempt count, acknowledgement latency, and at most 20 feedback samples.
Retries share the window. Session/connection changes and superseding heater writes clear it.
This monitor neither retries commands nor stops Replay. It does not read the PLC target register or prove flame state.

Heater retry outcomes: search `event:replay_delivery_result` or `event:manual_heater_delivery_result`.
After an initially failed delivery,
the existing retry loop emits one info event: `recovered`, `exhausted` (three total attempts),
`cancelled` (ownership ended), or `retry_unavailable`. Extra includes the logical target, total
delivery attempts, last applied response, elapsed milliseconds, session ID, and connection epoch.
These are message events, independent of the 10% trace sampling. Distinct delivery results survive
SDK dedupe and group by outcome. The original request/hardware error is not captured again.
Ordinary first-attempt successes and cancellations before any failed response are not reported.
Verified manual heater writes share the bounded delivery helper and carry `origin=manual`; Replay
uses `origin=replay`. Manual results include the connection epoch but do not require a roast session.
PID commands do not use this retry loop. Recovery acknowledges the command response,
not physical heat or flame state; cancelled delivery can still have an in-flight PLC command.

## Edge

```ts
import { captureEdgeException, respondServerError, serveWithSentry } from '../_shared/sentry.ts';

serveWithSentry('function-name', async (req) => {
  // thrown errors are captured here
});
```

A branch that returns 500 without throwing uses one call. `respondServerError` already captures:

```ts
return respondServerError('function-name', 'Public message', err);
```

When the response body is custom, capture and return it yourself:

```ts
await captureEdgeException(err, { function: 'function-name', status: 500 });
```

Status below 500 is dropped.

## Sidecar

Unexpected protocol or hardware failure:

```python
self._capture_hardware_error(exc, "event_name", once=True)
```

`once=True` when a retry loop would emit the same event again. An expected disconnect is `sentry_sdk.add_breadcrumb` only. Do not `capture_exception` beside `_capture_hardware_error`.

Do not log an exception at ERROR before the classified capture: LoggingIntegration can send it first
and SDK deduplication can discard the event with hardware tags. Use WARNING for the accompanying log.

S7 failures carry bounded `s7_operation` context across the executor boundary. It records the operation,
stage, elapsed time, completed writes, and whether a compound actuator command reached its final zero.
Command readback records `readback_role`, `readback_db`, `readback_offset`, `readback_expected_hex`,
and `readback_observed_hex` alongside `readback_matched`. These are encoded register bytes, before
logical scaling; Giesen logical heat 0 is raw `0001`, while raw `0000` is AUTO.
A cancelled read can still have an active native call; `await_cancelled` does not mean that call stopped.
These facts observe existing I/O and do not add PLC reads, writes, retries, or change time limits.
Completed W60A button reports belong to Python; the webview reports only its own request failures with
the action attached. Successful transmission is not proof of physical movement.
Repeated failures during one control command's retries are deduplicated. One captured failure alone
does not establish successful recovery or whether the HMI changed the setting.

Search hardware incidents by `event` and `protocol` as well as release. Production Python events have
been observed with `runtime=CPython ...`, so `runtime:sidecar` alone can miss them.

The shared webview readiness wait reports `sidecar readiness failed` once per outage when it rejects.
The report includes attempt count, elapsed time, final response category, and prior readiness history.
Successful readiness allows a later outage to be reported again; concurrent consumers share the wait.

## Rust

A terminal failure the app will not retry: `sentry::capture_message` at `Error`, same shape as sidecar spawn-dead in `src-tauri/src/lib.rs`. A retry that may still recover: `sentry::add_breadcrumb` only.

Sidecar lifecycle breadcrumbs retain spawn/readiness stages, exit code/signal/uptime, and a bounded
history of fixed stderr classifications. Arbitrary stderr text is not sent: connection details, paths,
credentials, and user text must not leak through native diagnostics. Unclassified chunks are counted.
Those breadcrumbs attach to the existing terminal failure event. A recovered restart does not itself
create an event under the current reporting policy.

## Payload

Fixed codes only: `feature`, `rpc`, `table`, `event`, `function`. Leave out host, port, serial, path, token, email, and user-typed text.

## New helper

Add a function on `sentry.ts` or `sentry_config.py` only when the event is not an exception (`captureMessage` with its own fingerprint) or needs session dedupe. Extend the matching test. Features call that helper. They do not import `@sentry/react` to capture.
