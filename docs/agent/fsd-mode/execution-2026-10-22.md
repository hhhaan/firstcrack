# FSD-02 and FSD-03 execution

Parent is `4787aeb7d6d7db826d44a5e1eb71ed3888e7c131` on `feat/fsd-mode`. Initial working tree was clean. The operator explicitly authorized implementation, virtual and actual-app verification, independent review, and local commits. Publication and physical operation remain excluded.

## Workflow

- [x] Read the Principles section of the poteto-mode skill.
- [x] Phase A: Frame.
- [x] Phase B: Design the workflow.
- [x] Phase C: Run the loop.
- [x] Phase D: Keep the audit trail.
- [x] Phase E: Verify and hand back.

Completion requires both stages to satisfy every applicable implementation, unit, live, performance, review, media, source-identity, and local-commit requirement in the saved plan and FSD-02 contract. Missing or indirect evidence remains unchecked.

The saved architecture and wire contract are settled. A second architecture competition is skipped. FSD-01 is not reimplemented. Its exact parent snapshot is retained under `/tmp/first-crack-fsd02-parent-4787`, and its compatibility driver is rerun before and after FSD-02.

## Throughput checkpoint

The critical path is FSD-02 session safety, real thermal execution, review, and commit, followed by FSD-03 integration and History verification. There are three independent FSD-02 implementation areas. Pure numerical code and tests have one owner. Session, runner, manager, HTTP routes, and adapter observations have one owner. Shared frontend protocol and Charge propagation have one owner. Root owns runtime verification and evidence documents. Shared files have only one writer.

The primary risks are lease revocation during blocked I/O, unresolved terminal writes, provenance rejection, and receipt recovery after Drop. These require real execution in addition to tests. Maximum reference size, 600 logical ticks, separate 60-second cadence trials, and five interleaved parent/head trials remain required. Initial host load averages were 3.28, 3.38, 3.37. Performance results must retain load, errors, completed work, and trial variation.

## Verification sequence

1. Capture the parent FSD-01 compatibility run and retained source snapshot.
2. Implement the three nonoverlapping FSD-02 areas against the frozen contract.
3. Run focused tests, the real HTTP lanes, deterministic numerical fixtures, and performance trials. Fix demonstrated defects.
4. Collect live protocol screenshots and a 30 to 60 second recording. Run independent ownership and provenance reviews and the repository gates.
5. Commit FSD-02 locally. Record its parent, SHA, and verified source hashes.
6. Implement FSD-03 reference construction, visible-view controls and lifetime, and durable receipt ingestion through existing save paths.
7. Exercise the actual app through start, tracking, takeover, stop, save, and History reopening. Collect the UI lanes, media, performance evidence, and independent review.
8. Run the required full gate, commit FSD-03 locally, audit source identity and every checklist item, and report the evidence.

## Tools and limits

All shell invocations start with `rtk`. Package commands use pnpm. Runtime servers bind owned loopback ports and refuse port 9999. Ordinary `pnpm dev` and the existing shared-sidecar bootstrap are excluded because they can affect port 9999.

Aside is installed and its guide and REPL guide were read. Browser inventory succeeded. `/deslop`, `control-ui`, and `control-cli` are unavailable in the current tool inventory. Their execution is not claimed. Actual diff cleanup, comment review, HTTP execution, and app media remain required.

## Current evidence

FSD-02 is committed as `00e3ba9d5c7c67bf4f6eb2c0439ffa837bfe2869`; its retained evidence and committed-source audit are linked from `fsd02-verification.md`. FSD-03 implementation, three scoped independent reviews, all real app lanes and the full gate have passed. Its final performance series and integration verdict have also passed. Evidence is retained under `03-handoff-01a16342`; local commit and post-hook identity audit are complete. Its external `commit-evidence.json` is the final SHA authority. All 58 changed files, 688 reviewed runtime files and the strict performance evidence/source check match. See `fsd03-verification.md`.

The operator changed model routing during final verification: general implementation and fixes use `gpt-6.1-sol` / `medium`; complex control, design, analysis and final review use `gpt-6.1-sol` / `xhigh`. The final integration reviewer and performance analyst were replaced accordingly; completed earlier independent reviews remain retained evidence.
