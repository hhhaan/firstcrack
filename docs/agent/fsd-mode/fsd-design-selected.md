# FSD selected architecture

Use candidate B's deep `HeaterControlSession` as the base. The independent judge scored B 19 and A 18 against compatibility, I/O barriers, ownership, provenance, and API depth. Root accepts B because one session can own control authority, pending I/O, the lease, and terminal transitions without adding more lifecycle branches to the connection manager.

Keep `RoasterManager` as the adapter and acquisition boundary. Preserve its public fixed-PID methods for existing callers. Move PID lifecycle orchestration into the session and migrate internal call sites in one unit. `PidRunner` owns numerical progression and measurement hold/fault detection. It cannot grant itself new terminal authority. The session authorizes the runner's normal and final writes using immutable generation tokens.

Graft candidate A's actuator-aware bounds into the existing PID calculation before its back-calculation. Preserve fixed-mode defaults. Graft A's complete frozen reference contract with source machine and session identity, Celsius raw BT, acquisition timestamps, Charge-relative time, sensor clock, and processing provenance. Retain B's source-sample anchored backdated Charge policy and immutable uncertainty/reconciliation receipts.

## FSD-01 contract

Create `src-tauri/sidecar/heater_control_session.py` as the only owner of heater generations, actual-write barriers, and fixed-PID lifetime. Keep substantive wire validation in `control_guard.py`. Keep sensor acquisition in manager and PID calculation in existing modules.

HTTP `origin` accepts only manual or Replay. Safety and PID origin tokens are internal and cannot be requested through JSON. Legacy ordinary manual writes remain accepted only without a conflicting automatic owner. Manual takeover is explicit. Fan and drum writes never claim heater ownership.

Add a server-issued Replay ownership claim. A claim names the expected current generation and connection epoch. Every Replay heater command and retry carries the issued generation and epoch. Manual takeover revokes them synchronously. An old claim, old command, or old retry arriving after takeover must fail. Giving a new generation to a delayed request when it arrives is insufficient. Reacquisition requires an explicit new Replay activation, not a lazy claim inside a stale write callback.

Expose current owner and generation in runtime status for client coordination. Extend the existing sender transport to retain the winning origin of the heater role in a mixed-role batch. Integrate Replay activation and release in the existing composition/hook without sibling-feature imports. Preserve fixed-PID endpoints and protect their post-await callbacks with their run generation.

S7 rechecks epoch and owner generation inside its thread lock immediately before each physical write, after throttling. Keep its executor future alive under cancellation and provide a real completion barrier. Probat and virtual get equivalent admitted-write fencing. Already-started writes may finish. No superseded queued write may begin after an acknowledged takeover or terminal barrier. Timeouts return uncertainty, retain outstanding work, and never report completed takeover.

Return true sample acquisition time and identity from manager. Cached or stale data never acquires a fresh identity. Recheck current time and runner generation after reads. Integrate each accepted sample once. Reject non-finite, future, backward, or foreign-session samples. Preserve fixed PID's existing processing and normal stop choices.

## FSD-02 and FSD-03 contract

Implement frozen curve parsing and common dt-aware control filtering in pure `roast_target.py`. Extend the same session and runner rather than starting a second controller loop. All physical curve capability stays false. Use the virtual constants proposed by the candidates only as test configuration, not as physical qualification.

Preserve one Charge origin. Manual Charge uses an accepted current sample or server time. Automatic backdating must name a retained source-sample anchor, not a freely trusted client timestamp. Duplicate identical starts preserve origin. Missing or foreign anchors make curve mode unavailable. Report the accepted origin to align app time rather than silently retiming later.

The visible healthy control UI owns lease renewal. Sample collection may continue outside the view, but cannot renew a hidden or crashed control UI's authority. Lease expiry revokes immediately independently of blocked reads, then schedules an explicit terminal command behind the retained writer barrier.

Raw references and live samples use one documented filter seed, cadence, warmup, and reset policy. Curve following requires both TP gates and qualified virtual initial conditions. Keep the Charge timeline. Pre-TP Gas remains manual. There is no silent fallback to synthetic, displayed, legacy, or Fahrenheit data.

Journal command receipts by session and sequence. A transmitted or confirmed logical setpoint is distinct from heat feedback and flame state. Retain uncertain outcomes and append later reconciliation rather than rewriting receipts. Recover and deduplicate through existing roast event persistence, including late Drop and save boundaries. No new temperature archive or database schema is planned.

## Execution and proof

Implement FSD-01 first and verify its ten scenarios plus the common baseline before the first local commit. Then implement FSD-02 and FSD-03 in order. The active objective overrides intermediate operator pauses with evidence collection and continued local work. Publication and physical actuation remain prohibited.

Root baseline passed 729 sidecar tests and the full local gate using a loopback public test URL. A real private HTTP run recorded 500 successful virtual commands and reproduced a Replay-origin heater write accepted during active fixed PID. See `fsd-baseline-live.json`. Neither design comparison nor baseline proves the new implementation.

All available design seats used the project's architecture model `gpt-6-astra`. The comparison is independent-agent structural exploration, not a cross-vendor model review.
