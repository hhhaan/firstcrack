# FSD-03 verification

Parent: `00e3ba9d5c7c67bf4f6eb2c0439ffa837bfe2869`. Branch: `feat/fsd-mode`.
Implementation, independent review, the full gate, all app lanes and final performance have passed. Local commit and post-hook source audit are complete; the final SHA is recorded in the linked external commit manifest.

Durable evidence root: `/Users/hanseungheon/.codex/agent-store/first-crack/docs/fsd-evidence/03-handoff-01a16342`. Runtime artifacts are under `evidence/`; `commit-evidence.json` records the final local SHA, parent and post-hook byte comparison.

## Implementation

The recorded source builder reads the original raw TSV through the existing R2 transport. It validates the complete header, every row, acquisition identity, processing metadata, machine identity and explicit Charge/Drop. Only the exact leading chart seed with both provenance cells absent can be excluded. Client raw TP and filtered target qualification match the frozen server contract; the server remains the final admission and digest authority.

The existing machine-control composition owns the explicit FSD entry, server status and local lease authority. A mounted view can adopt observed status without adopting renewal authority. Collapse preserves the run; hidden/unhealthy/unmounted views and workspace/reference/session changes stop renewal and request termination. Gas stays locked until stop is acknowledged; fan/drum remain independent. Fixed PID and Replay cannot compete with FSD. Absolute temperatures and differences convert separately for display.

Drop/End dispatch a bound closing request before the completed-batch transition resets view state. The sidecar's terminal-run path now closes only its matching current Charge when that terminal authority is still the latest run. It cannot close a replacement Charge or a newer active/terminal run and does not add a heater write. This narrow FSD-03 integration correction is independently checked against the accepted FSD-02 parent.

The app-shell collector reads receipts without renewing leases. It validates session/Charge/clock/cursor identity, preserves immutable attempt/transmitted/uncertain/reconciliation evidence and explicit gaps, and deduplicates by Charge and sequence. Existing Control events, `applied_control`, sampled `heater_set` and Replay density guards remain the storage path.

Save drains the known cursor and preserves late evidence through the existing pending checkpoint transport. An evidence-only outbox retries saved unsynced receipts. Recovery reconstructs known pending receipt identity and appends it before upload or checkpoint removal, including a successful save whose response was lost. Late append uses an owner/session-scoped events-only JSONB compare-and-swap, rereading and merging concurrent History edits; it never repeats the inventory save operation. History shows the original receipt outcomes read-only.

## Independent review

Evidence originates in `/tmp/swarm-fsd03` and is retained under the durable evidence root before acceptance.

| Scope | Evidence | Result |
| --- | --- | --- |
| Strict reference and qualification | `reference-independent-review.md`, independent formatter probes and cross-language results | PASS; 1,200 client/server cases have zero admission or TP-time mismatches |
| Control, ownership and view lifetime | `review-control-final.md`, external race/panel/composed-hook probes and real backend probes | PASS; 13 independent frontend cases, terminal Drop and newer-run/foreign-Charge fences |
| Recording, save recovery and History | `review-receipts-final.md`, independent collector/save/CAS probes | PASS; 12 independent cases, 46 focused repository tests and 17 unchanged source hashes |
| Final cross-scope integration | `review-integration-final.md`, `review-integration-hashes.json` | SCOPED PASS; no unresolved proven issue; 33 changed production files and all 688 runtime files frozen |

The reviews returned proven stale stop/renew/admission races, entitlement/stop-access regressions, terminal Drop closure defects, and three receipt durability/cursor defects to their owners. A passing earlier round was not treated as acceptance of a later source change. Root's narrow Replay entitlement correction preserves active stop while blocking new starts and has its own repository regression.

## Actual app method

`e2e/fsd.playwright.config.ts` launches the real Vite entry on an owned strict port and never invokes the shared port-9999 global setup. Every scenario owns a fresh token-protected aiohttp sidecar and real virtual thermal adapter. Normal monotonic time and production control scheduling remain active. The fixture declares 180 C initial BT, cools through 22 seconds and uses the real manual Gas UI to recover TP before explicit FSD start. Reference rows come from real virtual adapter acquisition under a declared fixture clock.

Browser routing forwards sidecar requests directly to that owned port before any network access to the app's constant port 9999. Unmatched traffic is aborted and fails the scenario. Supabase/R2 and Tauri filesystem/store/tick boundaries are explicit local fixtures; application components, stores, hooks, TSV queue/format, save coordination and History rendering are real. This is browser application proof, not native desktop or hosted database proof.

The existing E2E remount bridge gains a test-only view fault trigger. It throws inside the actual view error boundary so collection above the boundary and lease cleanup can be observed independently. It never grants control authority. Browser-native selection, clicks and keyboard input drive normal start, control, stop, save and History actions.

## App lane matrix

`final-app-1/` contains ten passing final-source scenarios. Its last scenario exposed a fixture-only native dialog omission: the Tauri discard confirmation returned no answer. The fixture now presents a browser confirmation that the test explicitly accepts. `final-app-completion/` passes both that batch-boundary scenario and the full start/takeover/save/History flow. Production source did not change. `final-app-media/` repeats the latter with the receipt section scrolled into view.

| Plan lane | Actual scenario |
| --- | --- |
| Parent/head regression | Same manual Gas and Replay interactions; parent lacks FSD entry |
| Start/tracking | Recorded thermal reference, actual correction and server target/PV/Gas |
| Unavailable references | Synthetic, legacy, failed download and incompatible machine reasons |
| Ownership | Replay and fixed PID exclusion, manual Gas locked, fan/drum independent |
| Manual takeover | Acknowledged stop followed by a new manual Gas command |
| View lifetime | Collapse, navigation, remount and actual view error boundary |
| Batch boundaries | Drop closes Charge, cancellation remains terminal, next Charge has a new identity |
| Reference/workspace | Frozen generation stops before another selection/workspace is used |
| Keyboard/units | Keyboard start and takeover, Fahrenheit display, Celsius wire reference |
| Receipt/History | Delayed receipt polling, save, real History rendering and repeated acknowledgement deduplication |

## Checks and limits

| Check | Final evidence | Result |
| --- | --- | --- |
| `rtk proxy pnpm verify:sidecar` | `sidecar-gate-final.log` | 933 passed; 203 existing warnings |
| `rtk proxy pnpm typecheck` | `typecheck-final.log` | Both production and test configurations passed |
| `rtk proxy pnpm test src/features/machine-control src/views/active-roast` | `scoped-frontend-final.log` | 60 files, 842 tests passed |
| `rtk proxy env VITE_SUPABASE_URL=http://127.0.0.1:1 VITE_SUPABASE_ANON_KEY=local-test-key pnpm verify:all` | `full-gate-ready-2.log` | Exit 0; 2,973 frontend tests plus one existing skip, 933 sidecar tests; architecture, i18n, Knip and other gate checks passed |
| Final sidecar HTTP regression | `final-sidecar-regression.json` | All ten curve lanes passed with stable final Python source |
| Final browser app lanes | `final-app-1.log`, `final-app-completion.log` | All eleven scenarios passed across the retained runs; the excluded fixture failure remains visible |
| Real application video | `final-app-media/…/video.webm` | 41.12 seconds, VP8, 1600 × 1000; start, correction, takeover, save and History. Earlier final capture is 44.08 seconds |

The first full-gate retries correctly failed on a new test's formatting and the missing standalone FSD Playwright/RTK discovery entries. These were corrected; no checks were disabled. Raw `rtk proxy` output and exit status were used because the installed filtered RTK typecheck command can incorrectly summarize a failed test typecheck as successful.

## Performance

The accepted clean series is `perf/accepted-run.json`, `perf/final-browser-run.log` and `perf/report.md`; raw trials, payload sizes, CPU samples, separate profiles and the source checker are retained alongside them. Twelve tests passed in 3.6 minutes, including five interleaved exact-parent/head pairs with 100 ms transport delay. Two hundred measured manual commands reached the virtual writer in exact order.

| Frozen budget | Accepted measurements | Result |
| --- | --- | --- |
| Added p95 manual response ≤50 ms | Paired p95 difference median −0.30 ms; range −7.30 to +4.40 ms | PASS; no speedup claim |
| Stop display ≤500 ms poll +250 ms after acknowledgement | Median 339.42 ms; maximum 351.85 ms | PASS |
| Bounded 2,048-receipt ingestion <16 ms CPU | Five runs: median 7.70 ms; range 7.20–13.20 ms | PASS |

Stop completion requires rendered `Stopped`, the visible operator reason, no Stop control and enabled manual Gas. The earlier manual-button-only timing was withdrawn; its artifacts and interrupted overlap attempts remain explicitly excluded. A stale owned strict-port server was removed before the accepted run; that preflight failure produced no accepted timing.

The backlog has 2,048 immutable receipts and one explicit overflow gap. Eight 256-row pages produce eight collector/store updates; repeated ingestion preserves identity and produces no duplicate. The CPU probe includes JSON parsing and production collection/store updates on a blank browser page; React rendering/layout are excluded. The separate real transport drain is 963.20 ms for eight sequential 100 ms delayed pages, not a CPU-ingestion figure. All twelve fixture cleanups are zero. Across full fixture activity there are 2,101 successful HTTP requests and 952 applied writes, with zero failures, rejections or unmatched requests.

The unchanged parent lacks FSD, so there is no invented parent FSD-stop ratio. Browser development rendering and explicit local service boundaries limit these results to this qualification machine. The report retains load-generator CPU, browser task duration and profiles to distinguish transport/poll waiting from receipt processing.

## Media and acceptance

The selected review media are `final-app-media/…/fsd-start.png`, `manual-takeover.png`, `saved-command-history.png` and `video.webm`; unavailable/fault/lifetime screenshots come from `final-app-1/`. The receipt section is scrolled into view in the History capture. Protocol media and the longer real thermal tracking trace remain in the accepted FSD-02 evidence root.

Root inspected the actual start, acknowledged operator stop and saved History screens, and presented screenshot/video links in the operator thread. The operator explicitly required continuation without an intermediate approval pause; no separate human approval is asserted. All fifteen retained app fixtures, including the excluded failed selector/confirmation attempt, have zero pending owned tasks/writers/connections, browser errors and unmatched traffic (`app-artifact-audit.json`).

The final integration reviewer is `gpt-6.1-sol` with `xhigh` reasoning under the operator's updated routing. Its full 688-file runtime-tree hash is `675113d6523db1f3158aefcfa19151b1a415b67df6b527a9a90fb073d0373a7e`. The root post-hook audit must match every reviewed runtime file and each changed committed file before completion. A receipt test's review-manifest delta is formatting only; the final full gate ran after that formatting. `commit-evidence.json` passes: all 58 changed files match the verified working bytes and committed blobs, all 688 reviewed runtime files match, and Git is clean. The separate strict performance post-hook checker also passes. The final SHA is stored in that manifest to avoid embedding a commit hash in its own contents.

The React Doctor regression scan is retained as `react-doctor-development.json`. Its timer-cleanup error is a false positive: capability polling checks cancellation before scheduling, clears the shared timeout on cleanup and unsubscribes. Snapshot-state warnings describe the intentional acknowledgement/status ordering fence; replacing that state with a derived value would remove the independently tested fence. JSON round trips in save tests deliberately model JSON checkpoints. No diagnostics were suppressed to pass a gate.

Local storage failure remains explicitly non-durable and visible; it is not reported as successful evidence persistence. Evidence never received before both app and sidecar history disappear cannot be recovered. Virtual command acknowledgement does not prove physical gas cutoff. Physical qualification, native desktop runtime, OS matrix, external customer services and publication are outside this task.

## Follow-up review fixes, 2026-10-22

The initial stage evidence above applies to `3ed833649c6cff7775f4a20dabe2c1d630b4d10a`. The follow-up fixes the completed-collection polling lifetime and removes duplicate observation state; it does not change PID tuning or heater authority.

- Receipt storage, monotonic sequence and pagination now live in `control_receipts.py`. The control session keeps admission, writer barriers, immutable attempt context and termination.
- A receipt page reports `sealed` only after a replacement Charge is admitted with all prior writers and terminal tasks finished. Drop alone does not seal the journal. The app reads its final page, stops polling, and prunes only saved/synced or explicitly discarded collections with no current/completed/pending-save reference. HTTP 410 records unavailability and ends collection; transient errors remain retryable.
- Sealed unsynced evidence survives restart in the existing outbox. Legacy checkpoints default to unsealed. Historical uncertainty stays recorded after the server proves no later observation can arrive.
- `observed.current` was removed in favor of `snapshotRef.current.curve`; heater-ownership classification is shared with composition. The separate local renewal authority is retained.

Validation artifacts are retained under `fsd-evidence/fsd03-review-fix-2026-10-22`. Focused development tests passed (75), followed by the final receipt/save group (19). Standalone sidecar checks passed all 933 tests. Ten actual virtual HTTP scenarios passed with stable sources. Both real-app paths passed: saved roast → History → next Charge, and Drop cancellation → discard → next Charge → collection eviction. Each checks that old-journal HTTP traffic stops across 2.5 seconds after the final sealed page.

At task entry, an unrelated `database.types.ts` working-tree modification was already zero bytes. It was preserved and excluded from this fix; the original workspace typecheck fails for that reason. Full verification of the proposed source ran in a temporary source-only validation fixture using the committed database types and the same installed dependencies: 2,981 frontend tests passed with one existing skip, typecheck and the remaining gates passed. Its sidecar run passed 930 with three external Artisan-reference fixture skips; the same Python bytes passed all 933 in the original checkout. No validation gate was disabled. The temporary dependency workspace-path warning did not trigger an install.

The source manifest and post-hook commit audit distinguish this follow-up from the initial stage's frozen hashes. Existing sidecar journals remain available through their connection lifetime for cursor recovery/idempotency; this change adds no global journal eviction policy, physical qualification or native-runtime proof.
