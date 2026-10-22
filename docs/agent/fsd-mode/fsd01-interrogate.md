# FSD-01 independent review

## Intent

Establish one heater owner, preserve acquisition identity, and reject superseded work before actual adapter I/O. A stop or takeover acknowledgement must reflect a completed command barrier. Preserve manual, Replay, and fixed PID behavior. Keep physical curve mode disabled.

## Reviewers

- Reviewer A used gpt-6-astra. It reviewed the production changes, callers, tests, documentation, and live driver. Two private virtual stop probes demonstrated critical races. Both passed after their fixes.
- Reviewer B used gpt-6-astra independently. It reviewed the same scope and traced disconnected-read and failed-start state transitions with the real virtual manager.
- A fresh delta reviewer independently verified the failed-start corrections, cancellation and supersession, real reconnect-zero behavior, and both earlier stop fixes. It then demonstrated a further pending-engagement zero-stop gap.

These are independent same-family reviews. No cross-vendor agreement is claimed.

## Act on

1. A pending hold-stop allowed a concurrent zero-stop to acknowledge OFF while the virtual heater remained at 80. Reviewer A reproduced it. Terminal tracking and forced superseding stops now make the zero command execute. The original probe passes.
2. An old OFF-stop could resume after a newer PID start acknowledged RUNNING, revoke its authority, and cancel its loop. Reviewer A reproduced the schedule using a blocked fan writer. The session now checks ticket ownership immediately after its drain, before any mutation. The original probe passes.
3. A failed read that disconnected the manager bypassed the PID disconnected fault because its post-await guard also required connection availability. Reviewer B reproduced it. Ownership and availability are now separate predicates. Its regular disconnected-read probe reports FAULT.
4. Initial feedback failure can disconnect the manager during PID engagement. The runner then enters RUNNING before the session rejects start, leaving no loop but a RUNNING runtime state. Reviewer B reproduced it. The same-runner failed/cancelled engage now settles as FAULT. The fresh delta reviewer verified the real reconnect task subsequently writes zero and superseding authority remains untouched.
5. A PID start waiting for its first feedback read has an OFF runner. A zero-stop treats OFF as completed and acknowledges while the virtual heater remains at 80. The delta reviewer and root both reproduced this with the real virtual adapter. The retained probe is fsd-evidence/01/probe-pending-engage-zero.py. The explicit PidOperation model now admits the terminal obligation before the initial drain. Root reran the original probe successfully, and the independent operation auditor verified the corrected engagement and cancellation schedules.
6. Disconnect can acknowledge with a newer manual writer still pending. A takeover scheduled after the zero adapter command but before its waiter resumed made the stop superseded. The generic disconnect catch then closed the adapter without another drain. The operation auditor observed disconnect completed with one writer pending and the adapter detached. Fixed in d17de5b: teardown closes admission synchronously, revokes, and drains retained writers before adapter disposal. A fresh retirement auditor and root independently reran completion, timeout, and cancellation schedules. Uncertain outcomes remain unacknowledged.
7. A failed explicit teardown retains an operation from the old connection while clearing its exposed runner. A fresh connection can later adopt that old operation with a new safety ticket and zero the new adapter. The operation auditor reproduced machine old to machine new, with the new heater changing from 55 to 0 despite pid_state being None. Fixed in d17de5b: explicit connection retirement clears the operation only after draining, while same-adapter automatic reconnect retains its terminal obligation. Independent and root probes confirm the replacement heater remains 55 and same-adapter recovery writes the required minimum.

## Consider

None.

## Noted

The root's third full gate passed 753 sidecar tests and 2,907 frontend tests. The post-freeze ten HTTP scenarios also passed. A third interleaved benchmark passed on production digest 6060b498b1d0cd303582316206428727836c78ffafedf01537c2b407fb5f8149. The newly demonstrated pending-engagement gap requires source changes, so these green results do not qualify the final lifecycle correction. Final-source verification remains necessary.

After the explicit operation correction, root-gate-4.log passed 777 sidecar tests and 2,907 frontend tests. Ten browser-driven PTY console scenarios passed with manifests and actual screenshots under fsd-evidence/01/live-console. Their source hashes are retained and these artifacts are labeled prior-source evidence because the independent connection-boundary findings require another correction. They are not final acceptance.

## Final production evidence and open verification coverage

The production correction is committed at d17de5b8b7be365735f7e1e4fbca56c6c841355d. Verification-only commit 8fa6a8720c3ac1182f4d7369e2950d419ff9993d adds public PID-fault and actual-PID auxiliary-control checks. Root gate 5 passes 786 sidecar tests and 2,907 frontend tests. The final production benchmark is fsd-evidence/01/perf/report-final.md. Retirement audit and root reproductions are fsd-evidence/01/retirement-independent-audit.json and retirement-root-probe.json. These resolve all seven demonstrated production findings.

Root then compared the live driver with every plan requirement. Several nominally passing lanes exercised narrower cases: Replay rather than blocked PID output, cache refresh rather than frozen-source fault, and post-replacement rather than queued old-connection work. Verification-only b2af35430f2d9e31ffbc0d4f2612f9b959af482a adds those actual scenarios. The worker and root independently passed all ten at identical script SHA 6b9b793975ebbb691ab4a5d02e9545db10614a5b413335c352bad7fe37cbe7b0. Final exact-head and exact-baseline browser PTY captures passed. FSD01 was accepted at b2af35430f2d9e31ffbc0d4f2612f9b959af482a. Earlier screenshots retain their exact SHA and remain valid only for their documented scope. A label containing PASS does not establish the missing behavior.

## Dismissed

An old manual retry with the same duty can match a later equal manual request. No demonstrated path reacquires automatic authority or changes the current manual value. It is not treated as a correctness finding without a concrete adverse effect.

## Agreement map

Both reviewers inspected ownership, adapter fences, and frontend Replay authority. Reviewer A found stop-transition races. Reviewer B found disconnected and failed-engagement status regressions. These are concrete independent findings; a green test suite had not covered those schedules. No hardware safety or physical tracking conclusion follows from these reviews.
