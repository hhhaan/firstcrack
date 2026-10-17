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

## Rust

A terminal failure the app will not retry: `sentry::capture_message` at `Error`, same shape as sidecar spawn-dead in `src-tauri/src/lib.rs`. A retry that may still recover: `sentry::add_breadcrumb` only.

## Payload

Fixed codes only: `feature`, `rpc`, `table`, `event`, `function`. Leave out host, port, serial, path, token, email, and user-typed text.

## New helper

Add a function on `sentry.ts` or `sentry_config.py` only when the event is not an exception (`captureMessage` with its own fingerprint) or needs session dedupe. Extend the matching test. Features call that helper. They do not import `@sentry/react` to capture.
