# FSD-02 verification

Parent: `4787aeb7d6d7db826d44a5e1eb71ed3888e7c131`. Branch: `feat/fsd-mode`.
Implementation, execution, performance and independent reviews pass. The local commit is recorded by the external commit manifest after hooks and source-identity checks. FSD-03 has not started.

## Retained evidence

Final evidence is retained at `/Users/hanseungheon/.codex/agent-store/first-crack/docs/fsd-evidence/02-handoff-01a16342`.
Working evidence originated in `/tmp/swarm-fsd02`. JSON files retain inputs, actual requests, command receipts, cleanup counts and source hashes; a Git HEAD alone does not identify the uncommitted source used in those runs.

## Execution

| Plan lane | Evidence | Result |
| --- | --- | --- |
| Fixed PID compatibility | `parent/fsd01-live.json`, `final-fsd01-regression.json`, `media/curve_mode_regression.json` | Parent and head each pass the ten existing HTTP scenarios; head adds curve mode |
| Rising target | `final-http.json`, `media/rising_target.json`, `captured-media/worker-2/` | Target equals interpolation at the server's Charge-relative time |
| Synthetic/legacy rejection | `media/reference_rejected.json`, `captured-media/worker-3/` | Rejected before changing ownership or Gas |
| Invalid points | Same rejection lane includes missing, duplicate, backward and nonfinite input | Explicit rejection without automatic writes |
| Charge identity | `media/charge_identity.json`, `captured-media/worker-4/` | Exact retained sample anchor; duplicate start preserves origin and lease |
| Both TP gates | `media/tp_gate.json`, `reference-tp-live.json`, `captured-media/worker-5/` | Live TP and reference TP independently block early engagement |
| Lease | `media/lease_expiry.json`, `captured-media/worker-6/`, `perf/` | Blocked reads cannot delay ownership revocation; stale renewal rejected |
| Drop/reference end | `media/terminal_boundary.json`, `media/drop_pending_io.json`, workers 8 and 10 | Revoked generation cannot restart; unresolved writes remain explicit |
| Saturation/recovery | `perf/runner-600-ticks.log`, `thermal-recovery-live.json`, `saturation-media/saturation_recovery.json`, `captured-saturation/worker-1/` | Production runner fixtures and two real-time HTTP thermal loops pass their declared criteria |
| Receipt recovery | `media/receipt_recovery.json`, `captured-media/worker-9/` | Cursor recovery and deliberate 2,048-entry overflow report the exact gap |

The ten media scenarios also include a separate acknowledged manual takeover. Each starts a fresh authenticated aiohttp server on an owned ephemeral loopback port. Physical adapters and port 9999 are refused. All final HTTP cleanup counters are zero.

`captured-media/worker-2/rising-target.webm` is a 42.24-second recording of the actual browser PTY interaction. Its running screenshot shows target, PV, owner and elapsed time. Both screenshot and video were linked to the operator while work continued. Chrome's recorder rejected the output paths; the installed Playwright Chromium successfully recorded the interaction. No unavailable recorder is claimed as executed.

## Performance and numerical behavior

`perf/report.md`, `perf/sequence.json` and all fifteen raw trial JSON files retain five interleaved parent-fixed, head-fixed and head-curve runs, each lasting 60 real seconds with the same 5 ms virtual write delay. All errors and cleanup counters are zero. Every curve trial admits the maximum 10,000-point reference and consumes 600 separate target evaluations.

- Added fixed-PID scheduling lateness p95: median 2.4422 ms; range -4.6427 to 7.9598 ms; budget 50 ms.
- Target lookup p99: worst 0.002916 ms; budget 5 ms.
- Lease revocation after deadline: worst 8.5194 ms. Logical minimum completion: worst 17.6438 ms; budget 250 ms.
- Five separate production-runner cases each execute 600 one-second ticks and 600 consumed writes. Nominal, noisy delayed and low-Ki saturation fixtures recover in 35, 35 and 60 seconds, respectively, with final-minute RMSE 0, 0.125333 and 0.195071 C.
- The additional real-time HTTP thermal fixture saturates at 100, recovers a continuous 30-second error band within 17.3963 seconds of its source heater change, and ends with 0.011788 C final-minute RMSE. This causal thermal fixture is distinct from the numerical 150/250/150 target fixture.
- The separate live terminal capture reruns that entire 200-second tracking window: recovery 18.46935 seconds, RMSE 0.0076429 C, 200 regulation transmissions, and zero cleanup counters. Root inspected its actual terminal screenshot.

The host retained its existing desktop load. Profiles are dominated by selector waiting; the lookup microbenchmark is not an end-to-end speedup. These are virtual software results, not physical-machine accuracy or cutoff qualification.

## Independent review

| Review | Evidence | Status |
| --- | --- | --- |
| Pure reference, filter, TP and PID | `review-pure.md`, `probe-pure-results.json` | PASS; includes 120,000 fixed-PID differential steps and 50,000 oracle observations |
| Session ownership, terminal writes, lease | `review-session.md`, `review-session-final.md`, final probes | Seven demonstrated defects fixed; fresh review PASS |
| Charge recording and Save | `review-frontend.md`, `review-frontend-final.md`, `review-recording-final.md` | PASS; fresh reviewer reran 50 cases, including both Drop boundaries and real TSV writes |
| Watchdog test synchronization | `timer-gate-fix.md` | Four unsupported 10 ms sleeps replaced by actual task/event completion under the unchanged 250 ms bound; production unchanged |

The recording reviews found lost pending samples, restored-origin loss, remount/late-settlement races, and post-Drop rows reintroduced by late acceptance. These were returned to the owner rather than accepted on the strength of passing unit tests.

## Repository gate and source identity

Final full gate: PASS, exit 0, `full-gate-ready.log`, with `VITE_SUPABASE_URL=http://127.0.0.1:1` and `VITE_SUPABASE_ANON_KEY=local-test-key`. Frontend 2,926 pass and one existing skip; sidecar 930 pass. Raw typecheck passes both production and test configurations. The separately required scoped frontend run passes 815 tests in 59 files. Registry, architecture, i18n, lint, harness, actions and other configured full-gate checks pass. Existing warnings remain nonblocking.

Prior failures remain retained and are not PASS evidence. Earlier gates found missing test provenance fields, unsupported test `.at` calls and two impure test-harness assignments. A concurrent sidecar gate exposed a test scheduling assumption. RTK's typecheck summary incorrectly reported success for the type errors; final verification uses `rtk proxy pnpm` to preserve raw output and exit status. One retry omitted the required local environment and correctly failed Vite configuration validation; it is retained as `full-gate-accepted.log`, not acceptance evidence.

The React Doctor regression scan is retained as `react-doctor-final.json`. Its timer-cleanup diagnostic is a false positive: both browser and Tauri fallback intervals have returned cleanup; the asynchronous listener path checks cancellation before allocation and immediately releases a listener resolving after cleanup. No suppression was added.

The final evidence manifest must compare verified file bytes with committed blobs after hooks run. A mismatch requires revalidation of the affected scope. Later documentation-only status updates do not invalidate unchanged production runtime evidence.

Root verdict: clean for the declared FSD-02 virtual scope. This conclusion combines the final gate with independent pure/session/recording review, actual HTTP/media and measured deadline evidence. It does not infer execution from type or unit checks.

Skipped: native desktop runtime, OS matrix and physical hardware. FSD-04 and publication remain outside this task.
