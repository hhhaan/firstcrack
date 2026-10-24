# Build supervised FSD heat control

> Current handoff. [progress and resume order](README.md). FSD-01 is accepted at b2af3543. FSD-02 implementation and independent runtime reviews are complete; its final gate and local commit are recorded in fsd02-verification.md. The active goal covers FSD-01 through FSD-03. FSD-04 remains outside scope. Older original-program checklist items below do not override this current scope or reopen completed work.

Give the operator an FSD mode that follows a recorded BT curve with automatic Gas correction.
Keep the operator responsible for Charge, pre-TP Gas, Drop, airflow, and drum speed in v1.
Start closed-loop correction only after qualified live TP and reference TP eligibility.
Use one sidecar heater owner and a frozen reference. Keep the Charge-relative timeline.
Deliver FSD-01, FSD-02, FSD-03, and FSD-04 in that order as local commits.
FSD means supervised roast automation here. Preserve the repository's Feature-Sliced Design import rules.

## How to read this

One box is one unit of work. Every box names the evidence that checks it. A nested box is a sub-step of the box above it. Check a box only when its evidence exists, a file, a log line, a screenshot, a test run, or a SHA. The body is a how-to. The appendices explain and record.

The program runs `/Users/hanseungheon/.codex/skills/poteto-mode/playbooks/autopilot-stack.md` with the repository's local-only delivery override. Treat each PR identifier as a review unit and a local conventional commit. Do not push, open a PR, tag, merge, or deploy until the operator explicitly requests that action. All four units stop at local review readiness. An implementation go does not grant publication or hardware-operation authority.

Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

Read Appendix A before treating the prototype as evidence. Read Appendix C before enabling a physical machine. Proposed budgets and scope choices are planning defaults. They are not measurements or accepted hardware limits.

For each unit, compare the exact verified parent commit with its head. Record both SHAs. Also retain the planning main SHA for unchanged-feature regression. Do not label a changed parent as untouched trunk or compare unlike feature paths as a speed ratio.

## Program checklist

### Arm the program

- [ ] State the protocol and this plan to the operator, then stop. Start execution only on the operator's explicit go. Record that message in the execution trail.
- [ ] Read `git show origin/main:AGENTS.md`, `git show origin/main:CONTEXT.md`, and `git show origin/main:docs/agent/active-roast-save.md` at program start. Record the base SHA. Read the installed skill paths in Appendix D. There is no `pstack/` directory in this repository.
- [ ] Mark `/loop 1h` skipped for this finite local implementation. Do not install an automation from a request for a plan. If the operator later requests unattended operation, establish its audit cadence and trail before dispatching owners.
- [ ] Use this tick prompt only for an explicitly armed unattended run. "Re-read the execution playbook from trunk. Audit the operation against it and fix drift in this tick. Probe every active lane and judge progress by side effects only. Stand down a stuck lane and dispatch its replacement now. Then post a short status message to the operator in chat only when the audit found a tracked change that no earlier status message reported, such as a PR opened, a code-ready head, a round launched or closed, a verdict, a merge, a stuck agent and the action taken, a blocker added or cleared, or a decision only the operator can make. Name every such change and nothing else. Do not repeat a table, the merged list, or an unchanged blocker. If the audit found none, end the turn with no reply text. Either way, log this tick's row in your decision trail. The row names the items reported, or none."
- [ ] On the operator's hold or stand-down, send every owner a zero-writes order. Record each owner's SHA and outstanding process.

### Spawn owners

- [ ] Assign architecture, control races, and final review to `gpt-6-astra`. Assign ordinary implementation to `gpt-5.6-sol`. Use one code owner per active unit. The available collaboration tool has no `poteto-agent` type field, so pass the role and absolute poteto skill path in each brief.
- [ ] Follow the local dependency chain `FSD-01 -> FSD-02 -> FSD-03 -> FSD-04`. Base each unit on the verified parent commit. Do not create remote PRs from these identifiers.
- [ ] Hold file ownership within each active unit. Serialize changes to `manager.py`, `pid_runner.py`, shared sidecar contracts, and the machine-control composition hook. Do not let two implementation agents edit those files concurrently.
- [ ] Hold the review gate for FSD-02, FSD-03, and FSD-04. Present their actual interaction evidence before declaring their behavior accepted. Keep physical actuation in FSD-04 under a separate explicit operator instruction.
- [ ] Write the throughput checkpoint before implementation. Blocking first steps are the baseline, safety contract, and source eligibility. Evidence is the FSD-01 report.
- [ ] Record independent workstreams. Pure reference execution and isolated UI fixtures may proceed in parallel only after their protocol is fixed. Each has separate files and receipts.
- [ ] Record shared mutable state. One manager owns the heater token, connection epoch, session clock, lease, and pending write generations. Keep this state under one implementation owner.
- [ ] Record the smallest safe decomposition. Use the four units below. Run the ten verification lanes in waves within the available agent slots. Ten lanes do not require ten concurrent agents or ten new scripts.

### PR mechanics, for every PR

- [ ] Mark forge discovery, PR creation, PR-facing pushes, CI babysitting, and merging skipped until explicitly requested. The repository's no-push rule overrides generic autopilot instructions.
- [ ] Run relevant repository checks before each local commit. Run `git add` followed by `git commit` with a conventional message of at most 72 characters. Keep hooks enabled and omit coauthor attribution.
- [ ] Run the installed code cleanup and comment review available at execution time. `/deslop` from `cursor-team-kit` is absent in this environment. Do not claim it ran. Use the installed simplifier and `/no-comments` for the actual code review, and record any missing tool.
- [ ] Before reviewing a parent or changing a child, record the exact head and parent SHA. Recheck changed callers if trunk moves. Keep the chain local unless publication is separately authorized.

### Verdict and merge, for every PR

- [ ] Run one independent gate verifier, the ten live scenarios, one performance verifier, and two focused audits at each code-ready head. Audit one focuses on ownership and stopped sessions. Audit two focuses on data provenance and command records. Reuse checks only when their covered code and dependencies remain unchanged.
- [ ] Accept a unit only when every required lane is PASS. A missing machine, absent screenshot, unrun probe, or uncertain command outcome remains unverified. Return proven defects to the owner before proceeding.
- [ ] Append a verified local commit to the chain. Apply the shipping playbook's patch-id rule only to evidence that actually remains valid. Do not translate local verification into permission to publish or merge.

### Boot recipe, for every live lane

Run each lane with its own virtual sidecar state and test database state at the exact commit under review. Use local isolated worktrees or fresh processes when cloud VMs are unavailable. Capture the actual app or terminal used by the lane. An image of a report alone does not prove the interaction.

- [ ] Record `git rev-parse HEAD`, the parent SHA, the scenario, and process identity before driving it. Start from the verified local commit without fetching or pushing new task branches.
- [ ] For sidecar lanes, launch the real aiohttp application with an ephemeral loopback port through the proposed `scripts/verify-fsd.py` driver. Refuse any adapter except `virtual`. Do not connect to or reuse port 9999. Preserve the normal token boundary.
- [ ] For browser lanes, start the real Vite entry with `rtk pnpm exec vite --host 127.0.0.1 --port 1420 --strictPort` in the isolated worktree. Route all sidecar requests to the owned virtual sidecar or an explicit mock. Abort unmatched requests. Do not run `pnpm dev`, whose predev kills port 9999 processes.
- [ ] Make the FSD Playwright project skip the current global sidecar bootstrap. Fix its reuse-on-port-collision behavior before relying on it. Do not silently fall back to an existing service.
- [ ] Use the available browser control skill for UI lanes. `cursor-team-kit` control-ui and control-cli are absent. Use the installed `aside-browser` skill for browser interactions and the named live HTTP driver for CLI lanes. Treat an unavailable screenshot or desktop control mechanism as a gap, not a pass.
- [ ] Save a live terminal screenshot for CLI lanes and app screenshots for UI lanes under `/tmp/swarm-<unit>/worker-<lane>/`. Save JSON or TSV with scenario inputs, targets, applied commands, errors, and stop reasons next to each screenshot. Never put tokens, serial details, or user data in receipts.

## Establish heater ownership and trustworthy samples (FSD-01)

**Accepted evidence.** FSD-01 accepted at `b2af35430f2d9e31ffbc0d4f2612f9b959af482a`, parent `8fa6a8720c3ac1182f4d7369e2950d419ff9993d`, production implementation `d17de5b8b7be365735f7e1e4fbca56c6c841355d`, program baseline `5c4649e86e9b9901fc7b68fc229ac31b7c5200cc`. The two follow-ups modify only the verification driver. All 26 production Python files match the final benchmark and production commit. Root gate 5 passes 786 sidecar and 2,907 frontend tests with one existing skip. Seven demonstrated review findings are resolved and the independent retirement probe passes. Root and worker independently pass the ten strengthened real-HTTP scenarios at the committed driver hash. Exact-head browser PTY captures cover all ten plus genuine running state in `fsd-evidence/01/live-console-b2af/`; exact-baseline same-input regression capture is `live-console-baseline-5c/`. Root inspected takeover, frozen-source fault, and baseline images. Final performance evidence is `perf/report-final.md`, not superseded reports. Logical virtual minimum is not physical shutdown. The capture fallback uses installed Playwright Chromium because Aside browser surfaces were unavailable. No native desktop, OS matrix, or physical qualification is claimed. `/deslop`, `control-cli`, and `control-ui` are unavailable; actual simplifier/comment audits and browser PTY evidence are recorded instead.

**Depends on.** None. Preserve current manual, Replay, and fixed-SV behavior while adding the guards that curve following requires.

**Files.**

- [x] Edit `src-tauri/sidecar/manager.py`, `pid_runner.py`, `control_guard.py`, and `adapters/s7.py` for ownership, timestamps, and the actual write boundary.
- [x] Edit `src-tauri/sidecar/main.py`, `src/shared/types/sidecar.ts`, `src/shared/lib/sidecar.ts`, and `src/features/machine-control/lib/controlSender.ts` for explicit command origin and takeover intent.
- [x] Cover `test_pid_runner.py` behavior with new `test_heater_control_session.py` and `test_pid_session_lifecycle.py` regressions, and extend `test_manager.py`, `test_api.py`, `test_control_fail_closed.py`, `test_s7_write_verification.py`, and control-sender tests. Create the reusable virtual-only `scripts/verify-fsd.py` driver.
- [x] Update `docs/sidecar-api.md` to match current disconnect behavior and distinguish a logical minimum command from confirmed physical gas shutdown.

**Build.**

- [x] Define one heater owner with a generation token. Include manual, Replay, and fixed PID modes in the state model. Extend the same operation with curve mode in FSD-02, as selected in fsd-design-selected.md. Keep requested Gas, accepted logical Heat set, and Heat feedback separate.
- [x] Carry the true acquisition timestamp and sample identity into `PvSample`. Recompute current time after awaits. Repeated cached samples must not reset age, EMA, or integral progress.
- [x] Fence every queued heater write at the last check before adapter I/O. Recheck the owner generation, connection epoch, and stop state inside the adapter's serialization boundary.
- [x] Make manual takeover explicit. Revoke the old generation, cancel unsent automatic commands, wait for the writer barrier, and only then acknowledge the manual command. Do not report completion while an earlier driver write has an unknown outcome.
- [x] Preserve existing fixed-PID stop policy. Retain the minimum-command terminal obligation across pending fixed-PID transitions. Add curve fault and lease policy in FSD-02 on that same operation. Keep a visible fault if that command fails. Never equate command-register readback with flame extinction.

**You see.**

- [x] The live driver's ownership scenario reports one current owner and no automatic write beginning after an acknowledged takeover or stop. Keep the ordered command transcript as evidence.
- [x] A delayed source sample reports its original age and reaches the configured hold or fault path without acquiring a new timestamp.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [x] Cover cached age, non-finite values, future or backward timestamps, stop during awaited read, queued write invalidation, takeover, reconnect, and failed final command. Run `rtk pnpm verify:sidecar`.
- [x] Cover legacy manual commands, Replay origin, and rejected conflicting commands in sender tests. Run `rtk pnpm test src/features/machine-control` and `rtk pnpm typecheck`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `gpt-6-astra` at the PR head, per the boot recipe.

- [x] Lane 1. Regression lane against trunk. Exercise manual Gas and fixed PID on parent and head. Save `manual-pid-regression.png`. Pass when both finish with the requested owner and acknowledged command while head also rejects a conflicting writer.
- [x] Lane 2. Send Replay-origin Gas while PID owns the heater. Save `owner-conflict.png`. Pass when the request is rejected and no competing adapter write occurs.
- [x] Lane 3. Queue PID behind a controlled virtual I/O delay, then request manual takeover. Save `takeover-barrier.png`. Pass when no superseded write starts after takeover acknowledgement.
- [x] Lane 4. Delay a PV read, then stop PID before the read returns. Save `stop-during-read.png`. Pass when returning PV cannot restart an automatic write.
- [x] Lane 5. Reuse a cached PV until it expires. Save `source-age.png`. Pass when source age increases and reaches the configured fault policy.
- [x] Lane 6. Inject NaN, a future timestamp, and a previous-session sample. Save `invalid-samples.png`. Pass when none reaches PID output calculation as a fresh valid sample.
- [x] Lane 7. Change the connection epoch while a command waits. Save `epoch-fence.png`. Pass when the old command never writes to the replacement adapter.
- [x] Lane 8. Fail the minimum-command write. Save `failed-stop.png`. Pass when the API and runtime retain failure and do not claim safe completion.
- [x] Lane 9. Change fan and drum while PID owns Gas. Save `independent-controls.png`. Pass when allowed non-heater controls work without transferring heater ownership.
- [x] Lane 10. Disconnect and reconnect the virtual adapter. Save `reconnect-off.png`. Pass when automatic ownership stays off and requires an explicit new start.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [x] Metric. Measure successful virtual `/control` request latency and acknowledged manual-takeover latency. Count writes, rejects, retries, errors, and pending driver operations.
- [x] Probe. Run 100 requests per trial over five interleaved parent and head trials using the same virtual adapter and controlled I/O delay. Keep error counts and command ordering with timings. Run the benchmark checklist before accepting a number.
- [x] Baseline. Record parent manual-command p95 and current fixed-PID stop behavior first. Record that parent lacks the new takeover guarantee rather than claiming a takeover speed ratio.
- [x] Rule. Proposed software budget is at most 20 ms added p95 for ordinary virtual command arbitration. Fail any stale write after an acknowledged transition. Fail an unknown in-flight outcome reported as completed. Hardware latency gets a separate qualification limit.

**Review gate.** None. FSD-01 is not review-gated. It introduces backend guards while preserving the operator interaction. Its live and independent code review evidence remains mandatory.

**Merge.**

- [x] Obtain the root's clean verdict at the exact local head SHA, backed by unit, live, and perf receipts.
- [x] Commit locally as `fix: enforce heater ownership and sample freshness`. Record the SHA and stop short of publication.

## Execute a frozen BT reference in the sidecar (FSD-02)

**Depends on.** FSD-01.

**Files.**

- [x] Create `src-tauri/sidecar/roast_target.py` for substantive pure reference validation, control filtering, and interpolation.
- [x] Extend `src-tauri/sidecar/pid_runner.py`, `manager.py`, `main.py`, and `config.py` through the existing PID loop. Do not add a second heater-writing loop.
- [x] Extend `src/shared/types/sidecar.ts` and `src/shared/lib/sidecar.ts` with the mode and session protocol. Extend `src/features/active-roast/model/useRoastActions.ts` only to transmit the accepted Charge origin.
- [x] Add `src-tauri/sidecar/tests/test_roast_target.py` and extend PID, API, and virtual closed-loop tests. Extend `scripts/verify-fsd.py` and `docs/sidecar-api.md`.

**Build.**

- [x] Define a discriminated PID request. Preserve legacy `{ sv }` as fixed mode. Curve mode carries a frozen reference, processing version, session ID, machine identity, connection epoch, and qualified control configuration. Reject malformed or unsupported input before ownership changes.
- [x] Require a real recorded Celsius source with raw BT and acquisition timing. Reject synthetic curves, missing provenance, duplicate or decreasing times, non-finite points, excessive gaps, incompatible machine identity, and data after reference Drop. Do not fall back to chart arrays or legacy displayed BT.
- [x] Specify one control-filter version for both reference raw BT and live raw BT. State the seed at Charge, time-dependent coefficient, warmup, repeated-sample handling, and gap reset policy. Reuse pure existing calculations where possible. Preserve existing display and fixed-PID processing. Qualify gains against this filter rather than copying them as approved settings.
- [x] Extend `/start` with an optional session identity and elapsed time since the accepted Charge mark. Reconstruct one sidecar monotonic origin, including a bounded backdated automatic Charge. A duplicate cannot reset origin. Missing or uncertain origin blocks curve mode. The client cannot later retime an active session.
- [x] Extend `/pid/on` with curve mode and `/pid/off` with session-bound termination reasons. Add `/pid/renew` for that session and owner generation. Keep stop idempotent. Reject old renewals and starts for closed sessions. Connection loss and process restart never auto-resume.
- [x] Permit curve mode only after explicit operator start, live TP eligibility, reference TP elapsed, filter warmup, and acceptable initial tracking error. Retain Charge-relative time. Do not shift the reference to make the TP times appear equal. Keep pre-TP Gas manual in v1.
- [x] Interpolate target BT from sidecar elapsed time. Apply calibrated lookahead only when the configuration supplies it. Prototype with zero lookahead until machine evidence selects another value. End the reference at Drop and terminate control with the explicit end policy. Do not hold its last target indefinitely or mark physical Drop automatically.
- [x] Bound output and changes in output using machine-qualified limits. Feed the actually permitted output back into anti-windup. Cover prolonged saturation and the current low-Ki integral behavior before accepting curve mode.
- [x] Renew the lease only from a responsive, visible operator control UI. Keep the lease checker independent of slow sensor reads and driver writes. Stop when that lease expires. A surviving app-shell timer must not renew a crashed or hidden control view.
- [x] Emit bounded, sequenced command receipts with session identity, elapsed time, target, requested Heat set, acknowledged logical Heat set, and outcome. Expose cursor replay after polling gaps. Stop or report a recording gap explicitly when receipts cannot be recovered. Do not create a new sidecar temperature recorder.
- [x] Advertise curve capability only for virtual operation at this stage. Keep physical machines disabled until FSD-04. Keep status and stop available regardless of entitlement changes.

**You see.**

- [x] The real virtual sidecar reports curve mode, authoritative elapsed time, current target, PV, owner generation, and stop reason. Its live receipt stream shows changing Heat set commands responding to target error.
- [x] Closing the lease-renewing client or exhausting the reference ends automatic writes. Restarting the client adopts terminal status without resuming control.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [x] Cover curve validation, interpolation, units, filter seeding, irregular sample intervals, duplicate Charge, backdating, TP eligibility, reference end, lease expiry during blocked reads, and old-session fencing. Run `rtk pnpm verify:sidecar`.
- [x] Add moving-target closed-loop tests with noise, delay, saturation, and low-Ki configurations. Assert finite bounded commands, no late writes, and explicit terminal reasons. Keep real-machine accuracy unqualified. Run `rtk pnpm check:registry` and `rtk pnpm typecheck`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `gpt-6-astra` at the PR head, per the boot recipe.

- [x] Lane 1. Regression lane against trunk. Run the same fixed-target virtual roast on parent and head, then request curve mode. Save `curve-mode-regression.png`. Pass when fixed mode remains equivalent and head adds bounded moving-target operation. Record that parent lacks curve mode.
- [x] Lane 2. Upload a real-format raw reference and follow its rising section. Save `rising-target.png`. Pass when the sidecar target matches interpolation on its own Charge-relative clock.
- [x] Lane 3. Submit a synthetic or legacy display-only reference. Save `reference-rejected.png`. Pass when start is rejected without changing the current Gas command or owner.
- [x] Lane 4. Submit duplicate, backward, missing, and non-finite curve points. Save `curve-invalid.png`. Pass when each has an explicit validation result and no automatic command.
- [x] Lane 5. Backdate Charge and submit the same start twice. Save `charge-origin.png`. Pass when origin stays fixed and target time matches the accepted Charge mark.
- [x] Lane 6. Attempt start before either TP gate, then satisfy both gates. Save `tp-engagement.png`. Pass when no pre-TP correction occurs and eligible start seeds from the current applied command.
- [x] Lane 7. Slow or freeze sensor reads while withholding lease renewal. Save `lease-expiry.png`. Pass when the independent expiry path revokes automatic ownership and records any uncertain final write.
- [x] Lane 8. Trigger Drop and reference exhaustion during pending I/O. Save `terminal-boundary.png`. Pass when both stop further automatic writes and old renewals cannot reactivate them.
- [x] Lane 9. Saturate output, then return the target to a reachable range. Save `saturation-recovery.png`. Pass when the integral remains bounded and the synthetic loop recovers within its declared fixture criterion.
- [x] Lane 10. Pause polling, recover command receipts, then overflow the bounded journal deliberately. Save `receipt-recovery.png`. Pass when recovered sequences are complete or a gap is explicit. No missing sequence is silently treated as recorded.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [x] Metric. Measure target-evaluation time, tick scheduling lateness, and API stop acknowledgement with virtual I/O. Count fresh samples, emitted commands, and terminal transitions. Measure fixed-PID cadence on both revisions.
- [x] Probe. Run the driver for 600 one-second virtual ticks and a separate real-time 60-second cadence run. Interleave five parent and head trials. Exercise the maximum accepted reference size and the same induced I/O delay. Keep CPU work distinct from hardware waiting.
- [x] Baseline. Record parent fixed-PID tick and stop timings first. Parent has no curve evaluator, so measure the added evaluator directly at head and do not invent a parent curve result.
- [x] Rule. Proposed budgets are target evaluation p99 below 5 ms, extra scheduling lateness p95 below 50 ms, and lease revocation within its configured deadline plus 250 ms under the isolated virtual load. Fail any skipped required deadline or false stop acknowledgement. Revisit the budgets only with evidence and independent review.

**Review gate.** The operator reviews the changed control protocol before acceptance.

- [x] Copy screenshot evidence for rising-target tracking and lease expiry into the review media directory for FSD-02.
- [x] Record a 30 to 60 second video of the live virtual run and its terminal state. Show the operator both screenshot and video evidence. Keep hardware disabled.

**Merge.**

- [x] Obtain a root clean verdict at the exact local head SHA. Include review of timing, lease ownership, output saturation, and executor barriers.
- [x] Commit locally as `feat: follow recorded BT curves in the sidecar`. Record the verified parent and head. Do not publish.

## Expose FSD mode and preserve command records (FSD-03)

**Depends on.** FSD-02, committed as `00e3ba9d5c7c67bf4f6eb2c0439ffa837bfe2869`. Final evidence and explicit fixture/native-service limits are in [FSD-03 verification](fsd03-verification.md). Existing PID/action/global-bootstrap code is reused where no change is needed; the isolated FSD Playwright project deliberately bypasses shared global setup.

**Files.**

- [x] Extend `src/features/machine-control/model/usePidControl.ts`, `useMachineControlComposition.ts`, and their tests. Put mutation wrappers in the slice's `api` segment if new wrappers are needed. Keep domain state in `model`.
- [x] Extend `src/features/machine-control/ui/MachineControlPanel.tsx`, `PidControlPanel.tsx`, `CollapsedControlStatus.tsx`, and the existing channel UI. Reuse their components and CSS tokens.
- [x] Extend `src/views/active-roast/ActiveRoast.tsx`, `ActiveRoastRuntime.tsx`, `model/useSidecarPolling.ts`, and `src/features/active-roast/model/useRoastActions.ts` for composition, lifecycle, and receipt ingestion.
- [x] Extend `src/features/active-roast/lib/serialize-roast-events.ts` only as needed for existing Control events. Preserve the current save and TSV contracts. Update affected fixtures and all four locale files.
- [x] Extend `e2e/global-setup.ts`, the app and sidecar fixtures, and the Playwright configuration. Add `e2e/tests/fsd-mode.spec.ts` with isolated virtual traffic and no access to an existing sidecar.

**Build.**

- [x] Expose an explicit FSD mode entry when recorded reference, qualified capability, entitlement, session, and engagement conditions are valid. Show the reason when a condition fails. Do not reveal only an already-active mode as the present PID UI does.
- [x] Show target BT, control PV, temperature error, Gas command, operating state, and stop reason. Explain the selected reference and supervised scope in operator language. Convert units only for display.
- [x] Keep the sidecar runtime as the source of truth. A failed start must not look active. A remount must not reset the target, start the controller again, or hide its stop control.
- [x] Stop lease renewal when the operator control view is hidden, crashes, loses its session, or changes workspace. Navigation away first requests stop and confirms the disposition. A failed request remains visible and lease expiry remains independent.
- [x] Add explicit manual takeover. Let the operator request Gas after revocation is acknowledged. Keep fan and drum controls independent. Block simultaneous Replay, fixed PID, and FSD ownership in both the UI and the sidecar.
- [x] Freeze the reference for the active generation. Require stop and rearm on a reference change. A cancelled Drop, new Charge, or restored checkpoint must never automatically resume FSD.
- [x] Ingest acknowledged command receipts by session and sequence. Reuse `AppliedRoastControl` and existing Control-event serialization. Keep intent separate from application outcome and Heat feedback. Recover gaps once, deduplicate repeats, and discard late prior-session replies.
- [x] Preserve sampled `heater_set` in TSV and the existing roast-save flow. Keep the Replay event-count guard that rejects dense PID-generated heat records. Do not turn FSD output into a future manual Replay plan silently.
- [x] Compose `active-roast` and `machine-control` in the existing view. Do not import one feature slice into another. Reuse the existing entitlement rather than inventing a paid tier.

**You see.**

- [x] The operator can reach FSD mode from an off state, start an eligible virtual session, observe correction, and take over Gas. The screen shows the sidecar's acknowledged state.
- [x] Saving and reopening that roast retains its applied command records without duplicating them or treating feedback as commands.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [x] Extend hook and panel tests for eligibility, failed start, ownership, hidden-view expiry, remount, reference change, unit display, failed stop, and late receipts. Run `rtk pnpm test src/features/machine-control src/views/active-roast`.
- [x] Extend serialization and save tests for sequence deduplication, gaps, and session boundaries. Run `rtk pnpm typecheck`, `rtk pnpm check:architecture`, and `rtk pnpm check:i18n`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `gpt-6.1-sol` at the PR head, with `xhigh` reasoning, is the updated review assignment. Root drives the isolated browser harness and supplies the lane evidence to that reviewer. Here the head is local; no PR is created.

- [x] Lane 1. Regression lane against trunk. Drive existing manual Gas and Replay on parent and head. Save `ui-regression.png`. Pass when both preserve those interactions and head adds a reachable FSD entry without a second writer. Record the missing parent FSD entry.
- [x] Lane 2. Select a compatible recorded raw reference and start eligible FSD. Save `fsd-start.png`. Pass when target, PV, Gas, and sidecar mode agree and the virtual thermal response changes with commands.
- [x] Lane 3. Select synthetic, download-failed, legacy, or mismatched references. Save `fsd-unavailable.png`. Pass when each blocks start with the specific reason and sends no start request.
- [x] Lane 4. Attempt Replay and fixed PID while FSD owns Gas. Save `ui-owner-conflict.png`. Pass when no competing writer reaches the adapter and stop remains reachable.
- [x] Lane 5. Take over Gas, then adjust fan and drum. Save `manual-takeover.png`. Pass when acknowledged takeover ends correction and non-heater controls remain independent.
- [x] Lane 6. Collapse the panel, hide the view, and induce its error boundary. Save `view-lifetime.png`. Pass when collapse preserves control, hiding or failure stops renewal, and a remount never auto-resumes.
- [x] Lane 7. Issue Drop, cancel Drop, then start the next batch. Save `batch-boundaries.png`. Pass when every previous FSD generation stays terminal and the next batch has a new clock and owner.
- [x] Lane 8. Change reference or workspace during operation. Save `reference-workspace.png`. Pass when the active generation stops and cannot accept stale updates from the previous selection.
- [x] Lane 9. Use keyboard controls and switch Celsius to Fahrenheit. Save `keyboard-units.png`. Pass when start, stop, and takeover are accessible and the sidecar reference remains Celsius.
- [x] Lane 10. Delay polling through several applied commands, save, reopen History, and repeat the final acknowledgement. Save `saved-command-history.png`. Pass when applied sequences appear once in the correct roast and feedback remains separate.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [x] Metric. Measure click-to-acknowledged stop display, ordinary manual-control response, and poll payload size with command-receipt recovery. Count failed requests and duplicate records.
- [x] Probe. Run five interleaved parent and head browser trials against the same isolated virtual sidecar with controlled 100 ms transport delay. Capture the actual rendered end state and sidecar command sequence. Probe a full bounded receipt backlog separately.
- [x] Baseline. Record parent manual-control click-to-state latency first. Parent lacks FSD, so isolate added receipt ingestion and measure its head end-to-end latency without a parent FSD ratio.
- [x] Rule. Proposed budgets are no more than 50 ms added p95 on unchanged manual interactions, stop display within one poll interval plus 250 ms after sidecar acknowledgement, and receipt ingestion below 16 ms for one bounded backlog on the qualification machine. Fail duplicate records or unmatched sidecar traffic regardless of speed.

**Review gate.** Present the actual interaction for operator review. The operator explicitly instructed continuation without a separate approval pause; evidence presentation does not assert human approval.

- [x] Copy screenshot evidence for FSD start, unavailable references, takeover, and faults into the FSD-03 review directory.
- [x] Record a 30 to 60 second video through the real app showing start, correction, and manual takeover. Post screenshot and video links to the operator. Keep physical actuation disabled.

**Merge.**

- [x] Record the root's clean verdict at the exact local head SHA and present actual UI evidence for operator review under the standing no-approval-pause instruction. Include actual History evidence rather than only component tests.
- [x] Commit locally as `feat: add supervised FSD mode controls and recording`. Record parent and head. Do not push or open a PR.

## Qualify one machine before enabling it (FSD-04)

**Depends on.** FSD-03 and an explicit operator instruction to perform the named physical-machine trial. Missing hardware authority does not block virtual completion, but it blocks physical qualification.

**Files.**

- [ ] Extend `scripts/verify-fsd.py` with non-actuating shadow analysis and qualification reports. Keep virtual and physical modes separate and make physical mode unavailable without the explicit trial configuration.
- [ ] Create `docs/agent/fsd-qualification.md` for the exact machine, reference provenance, batch mass, operating conditions, limits, and trial evidence. Do not store credentials or serial details.
- [ ] Edit `src-tauri/sidecar/roaster_registry.py` and the frontend registry only if qualification requires a configuration or capability change. Preserve registry parity.
- [ ] Extend moving-target and command-boundary regression fixtures with the qualified failure cases. Update the operator's FSD help with the measured scope and limitations.

**Build.**

- [ ] Record the exact machine variant, adapter protocol, reference source, batch mass, control-filter version, and initial thermal conditions. Until those facts exist, leave all physical curve capabilities disabled.
- [ ] Run non-actuating shadow comparison on real recorded sessions first. Record target, measured BT, proposed Gas, saturation, error, and unqualified regions. Shadow mode must never acquire heater ownership or call an adapter write.
- [ ] Establish numerical tracking-error, overshoot, slew, stale-data, lease, and minimum-command outcome limits before supervised actuation. Base them on the selected machine's permitted behavior. Do not copy the toy prototype's numbers or invent universal thresholds.
- [ ] Under the operator's explicit trial instruction, run repeated supervised batches on the same configuration. Keep a person at the machine controls. Do not induce dangerous physical faults to satisfy a software scenario. Run fault injections on the isolated virtual system.
- [ ] Verify the machine-specific minimum-command behavior and independent manual recovery. If physical cutoff or dead-sidecar protection is not proven, label the release supervised and record the limitation. Keep that case outside any claim of unmanned operation.
- [ ] Enable only the qualified configuration after its evidence passes review. Keep other machines and legacy reference formats unavailable. Do not deploy or tag from this plan.

**You see.**

- [ ] The qualification report identifies exactly which machine and batch configuration passed and links the observed BT errors, Gas commands, operator interventions, and stop outcomes.
- [ ] An unqualified machine still reports FSD unavailable. A qualified machine exposes FSD only within its recorded operating limits.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Prove shadow mode cannot invoke a control write. Add qualification fixture regression cases without embedding private roast data. Run `rtk pnpm verify:sidecar` and `rtk pnpm check:registry`.
- [ ] Run `rtk pnpm verify:all` at the final local head. Build the changed sidecar and native paths for the supported desktop matrix before any eventual release, separately from browser proof.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `gpt-6-astra` at the PR head, per the boot recipe. Physical lanes require the separate trial instruction and an on-site operator.

- [ ] Lane 1. Regression lane against trunk. Run the same recorded-reference validation and virtual target-evaluation trace at parent and head, then inspect head qualification eligibility. Save `qualification-regression.png`. Pass when head preserves those common results and enables only the reviewed configuration. Record that parent lacks the new qualification report.
- [ ] Lane 2. Run shadow analysis over recorded real sessions. Save `shadow-no-writes.png`. Pass when proposed corrections are reported and the adapter write count stays zero.
- [ ] Lane 3. Run the first operator-supervised qualified batch. Save `qualified-batch-1.png`. Pass when every predeclared field limit holds and intervention is recorded.
- [ ] Lane 4. Repeat the same qualified batch conditions. Save `qualified-batch-2.png`. Pass when the declared tracking and command limits hold again without changing the thresholds after seeing results.
- [ ] Lane 5. Test the agreed permitted initial-condition boundary under supervision, or keep it unqualified. Save `initial-condition-boundary.png`. Pass when operation stays within declared limits or start is rejected before automatic commands.
- [ ] Lane 6. Perform operator manual takeover during an otherwise normal supervised run. Save `physical-takeover.png`. Pass when command ownership and the machine's observed response match the documented recovery procedure.
- [ ] Lane 7. Observe normal Drop and FSD termination under supervision. Save `physical-drop.png`. Pass when automatic correction ends and actual machine behavior is recorded separately from the acknowledged logical command.
- [ ] Lane 8. Inject communication loss, frozen UI renewal, and blocked I/O only on the isolated virtual system. Save `fault-simulation.png`. Pass when stop reasons and uncertain outcomes match the reviewed failure contract.
- [ ] Lane 9. Select an unqualified machine or out-of-scope batch. Save `unqualified-disabled.png`. Pass when capability remains unavailable and no control request reaches the device.
- [ ] Lane 10. Save and reopen the qualified run, then compare operator evidence with stored command receipts. Save `qualification-history.png`. Pass when session identity, command sequence, source temperatures, and terminal reason agree.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Measure the existing recorded-reference validation and target-evaluation runtime on both revisions. Measure the new shadow-report generation separately. Measure control cadence, command latency, and tracking error in qualified real trials. Keep quality and speed metrics distinct.
- [ ] Probe. Interleave five parent and head validation and evaluation trials on the same recorded inputs. Run the added head shadow report with the same input and count every output row. For physical trials, keep each full batch's trace and configuration. Do not alternate unsafe configurations or claim a hardware comparison that was not performed.
- [ ] Baseline. Record parent validation and evaluation timing first. Record that parent lacks the new shadow report. Retain the existing manual or Replay trace as operating context, not an equivalent active-control benchmark.
- [ ] Rule. Proposed software budgets are no more than 10 percent added runtime for the common validation and evaluation work, plus shadow-report generation below two seconds for 10,000 input rows at head. Physical tracking, overshoot, cadence, and command limits must be written before actuation. No physical lane passes with unset limits or omitted interventions.

**Review gate.** The operator reviews qualification evidence before physical enablement.

- [ ] Copy screenshot evidence from supervised trials and explicit unqualified-machine blocking into the FSD-04 media directory.
- [ ] Present a 30 to 60 second video excerpt and the full trial trace to the operator. Include screenshot evidence of manual takeover. Record the reviewed configuration and leave publication pending.

**Merge.**

- [ ] Obtain the root's clean verdict at the exact local head SHA and the operator's qualification review. Leave FSD-04 incomplete if real evidence is missing.
- [ ] Commit locally as `feat: qualify supervised FSD for the tested configuration` only after that configuration passes. Otherwise commit virtual qualification tooling separately and report physical enablement as pending. Do not publish.

## Close the program

- [x] Check only boxes whose evidence exists. Distinguish implemented, verified virtually, qualified physically, and published. Missing field evidence remains an open item.
- [x] Deliver the local commit sequence, checked plan, actual validation output, screenshots, videos, qualification scope, and remaining limitations. Stop without pushing, opening PRs, merging, or releasing.

## Appendix A. Prototype evidence

Planning inspection used repository HEAD `5c4649e86e9b9901fc7b68fc229ac31b7c5200cc` on local `main`. No prototype branch or production implementation was created. The repository remained clean while the scratch probe was written outside it.

The throwaway [ramp probe](/Users/hanseungheon/.codex/agent-store/first-crack/docs/fsd-prototype/probe_pid_ramp.py) runs the existing `SoftwarePid` and `FirstOrderThermalModel`. Its [results](/Users/hanseungheon/.codex/agent-store/first-crack/docs/fsd-prototype/results.json) contain eight deterministic configurations. Each configuration runs 600 one-second steps from a 100 C target to 200 C. Every PID output advances the plant. The probe reports zero execution errors and bounded finite duty values.

The variations change the toy plant time constant, registry gain set, and lookahead. They show that the existing pure controller accepts a moving target and that these choices change its synthetic result. They do not select a production gain, filter, or lookahead. The toy plant has no transport delay, Charge-to-TP behavior, airflow, drum thermal mass, or physical safety model. Applying Giesen gains to it does not simulate a Giesen roaster.

Reproduce the planning probe with `rtk src-tauri/sidecar/.venv/bin/python /Users/hanseungheon/.codex/agent-store/first-crack/docs/fsd-prototype/probe_pid_ramp.py /Users/hanseungheon/han/first-crack-proj/first-crack /Users/hanseungheon/.codex/agent-store/first-crack/docs/fsd-prototype/results.json 5c4649e86e9b9901fc7b68fc229ac31b7c5200cc`. This behavioral probe has JSON evidence. It has no UI screenshot because it does not render a UI.

Earlier in this conversation, 60 existing PID tests and 14 existing hook/composition tests passed. Those fixed-target checks do not prove this proposed FSD mode. No FSD live lane, performance gate, or physical qualification was run while making this plan.

The empirical questions still open are actual processing provenance in candidate references, qualified engagement bounds, filter warmup, physical machine identity, batch mass, transport delay, gains, allowed tracking error, and minimum-command behavior. Preserve these as gates rather than claiming the scratch simulation answered them.

## Appendix B. Alternatives rejected

Updating `/pid/sv` from a React timer loses consistent timing when the view fails or browser scheduling changes. Keep the trajectory and safety lifetime in the sidecar.

Running Replay and PID as independent heater writers creates competing commands. V1 has one owner and no concurrent Replay feedforward writer. A later hybrid controller may combine recorded Heat set with PID internally after evidence justifies it.

Tracking the falling Charge-to-TP curve with a heat-only PID does not provide active cooling. The v1 planning default keeps pre-TP Gas manual and requires explicit eligible start after TP. This is a scope choice, not a demonstrated complete Charge-to-Drop autopilot. Full pre-TP automation is a separate extension using a qualified baseline heat plan under the same owner.

Using display curves, Fahrenheit chart coordinates, synthetic fallback, or raw BT against an unrelated filtered target creates unmeasured error. V1 requires raw recorded Celsius input and a specified common control-filter version. Legacy compatibility stays out of scope until separately qualified.

Copying one Artisan lookahead or one registry gain set across machines has no support in the virtual probe. Reference the approach and qualify the parameters on the selected machine.

Creating a separate `features/fsd` writer would split the current control lifetime. Extend the existing machine-control slice and compose it with roast-session inputs in the view. Preserve its public exports and import direction.

## Appendix C. Risks

FSD-01 must handle real executor semantics. Cancelling an asyncio task cannot withdraw bytes already being written by a synchronous driver. The acceptance promise applies after an acknowledged writer barrier. Unknown in-flight operations must remain uncertain, and queued stale commands must be rejected before I/O.

FSD-02 must distinguish the UI lease, sensor freshness, and hardware watchdog. A responsive sidecar can detect missing UI renewal. A dead or frozen sidecar cannot execute its own expiry handler. Independent machine safety remains outside the software guarantee.

FSD-02 needs a reference-processing contract before start can be accepted. Existing fixed PID uses a separate BT EMA. Historical displayed BT and its user-selected smoothing are not an interchangeable target source. The common filter, seed, cadence, and warmup require implementation evidence and subsequent qualification.

FSD-03 must not use the current E2E port-reuse behavior. Its isolated route and virtual-only driver are prerequisites to every actuation-style test. The default PID panel is currently hidden when off, so a protocol-only change does not create a usable mode.

FSD-03 receipt recovery prevents sampled TSV values from masquerading as complete command history. The bounded journal must report overflow and stale-session replies rather than silently losing or duplicating commands. No new temperature recorder or database schema migration is planned.

FSD-04 cannot treat logical Gas zero or register readback as proof of physical burner-off. Classic Giesen maps logical zero through an offset and reserves raw zero for AUTO. Verify the exact machine variant and machine-panel recovery before making physical claims.

The installed toolset lacks the pstack `control-ui`, `control-cli`, and `deslop` commands and the `poteto-agent` type. The plan names available substitutes. A substitute must produce the same direct evidence. An unavailable native desktop or supported-platform build remains a recorded gap.

Planning estimate is 4 to 5 development days plus 2 to 3 supervised trial sessions. This is an estimate, not a measurement or delivery commitment. The earlier 2 to 3 day estimate covered the optimistic core and UI path. Source inspection added ownership barriers, sample-age correction, reference provenance, lease behavior, isolated E2E, and command recording. Physical availability and tuning can extend elapsed time.

## Appendix D. Links and reading list

Read `AGENTS.md`, `CONTEXT.md`, `docs/agent/active-roast-save.md`, `docs/agent/data-fetching.md`, and `.dependency-cruiser.cjs` from the implementation base before editing.

Use the installed [multi-phase planning playbook](/Users/hanseungheon/.codex/skills/poteto-mode/playbooks/multi-phase-plan.md), [autopilot-stack](/Users/hanseungheon/.codex/skills/poteto-mode/playbooks/autopilot-stack.md), and [Feature playbook](/Users/hanseungheon/.codex/skills/poteto-mode/playbooks/feature.md). Apply repository overrides before generic publication instructions.

Run [how](/Users/hanseungheon/.codex/skills/how/SKILL.md) for FSD-01 and FSD-02. Run [architect](/Users/hanseungheon/.codex/skills/architect/SKILL.md) before implementation crosses module boundaries. Use [interrogate](/Users/hanseungheon/.codex/skills/interrogate/SKILL.md) if safety, lifecycle, or processing alternatives remain contested before acceptance. Keep an execution trail under [show-me-your-work](/Users/hanseungheon/.codex/skills/show-me-your-work/SKILL.md) when implementation begins. Planning itself does not arm that program.

Apply [Model the Domain](/Users/hanseungheon/.codex/skills/principle-model-the-domain/SKILL.md) to choose one explicit owner/session state. Apply [Sequence work into verifiable units](/Users/hanseungheon/.codex/skills/principle-sequence-verifiable-units/SKILL.md) to verify the safety foundation before curve execution and UI. Apply [Prove It Works](/Users/hanseungheon/.codex/skills/principle-prove-it-works/SKILL.md) to require actual app and machine receipts rather than promoting unit-test success into hardware qualification.

[Guard the Context Window](/Users/hanseungheon/.codex/skills/principle-guard-the-context-window/SKILL.md) split source exploration into sidecar and frontend reports. [Encode Lessons in Structure](/Users/hanseungheon/.codex/skills/principle-encode-lessons-in-structure/SKILL.md) selected the existing plan checker rather than a claimed manual format pass. [Type System Discipline](/Users/hanseungheon/.codex/skills/principle-type-system-discipline/SKILL.md) selected a discriminated fixed or curve request. [Never Block on the Human](/Users/hanseungheon/.codex/skills/principle-never-block-on-the-human/SKILL.md) kept product uncertainties as visible planning defaults rather than treating them as approval to implement. [Explain the Number](/Users/hanseungheon/.codex/skills/principle-explain-the-number/SKILL.md) kept the toy ramp results separate from hardware accuracy and tuning claims.

Artisan's [official FAQ](https://artisan-scope.org/docs/faq/) distinguishes command-event replay from background-curve PID following. The pinned [PID source at 9f214d0](https://github.com/artisan-roaster-scope/artisan/blob/9f214d02dfcf9ba62961669755b6f8a16ef98bce/src/artisanlib/pid_control.py) contains `calcSV`, which evaluates a smoothed background target at current time plus lookahead. Its recorded timestamp comment is a reminder to make Charge-relative conversion explicit in this application. Use these as design references. No Artisan code was copied into this plan's prototype.

The independent source synthesis is in [architecture notes](./fsd-architecture-notes.md). The plan-shape checker is `/Users/hanseungheon/.codex/skills/poteto-mode/scripts/check-plan.mjs`. Its output verifies document structure only. It does not verify FSD behavior or machine safety.
