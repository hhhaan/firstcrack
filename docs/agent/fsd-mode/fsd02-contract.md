# FSD02 control contract

Root accepted this implementation contract after reading its complete wire, numerical, lifetime, and receipt requirements. No FSD02 production file changed during refinement. Grounding is commit `d17de5b8b7be365735f7e1e4fbca56c6c841355d` in `first-crack-fsd-mode`. Later test-only commits preserve that product-code grounding. The earlier 8fa captures cover their recorded narrower scenarios. Verification-only b2af354 adds the missing real-loop coverage; root independently passed all ten strengthened scenarios. FSD01 was accepted after final b2af354 and exact-baseline captures. Implementation was authorized, then all owners were interrupted for the user-requested worktree relocation before any FSD02 source edits. Resume in first-crack-fsd-handoff, not the historical first-crack-fsd-mode path.

This contract refines the [selected architecture](fsd-design-selected.md). Candidate B's `HeaterControlSession` stays the only heater authority. Candidate A contributes the full raw source contract and actuator-aware PID bounds. No architecture comparison is restarted. The [FSD02 plan](2026-10-22-fsd-mode-plan.md), [source notes](fsd-source-contract-notes.md), and [FSD01 review](fsd01-interrogate.md) remain evidence, with this document resolving the concrete API choices below.

## Grounded behavior and scope

`HeaterControlSession` owns tickets, retained writers, and `_operation: PidOperation | None`. `PidOperation` already exists before initial feedback or drain completes. FSD02 extends that operation rather than adding a `curve_active` flag or another writer. `PidRunner` owns numerical progression and hold/fault detection. Manager owns the connection and acquisition. The current manager `_pv_snapshot` uses its dedicated fixed-PID EMA. Curve mode must obtain `bt_raw` from the same acquisition, without changing that fixed processing.

The selected design's `currentPidOperation` means this existing `_operation` record. A mode payload belongs on that record. Its lifecycle phase and runner state are different concepts. A runner can be OFF while a starting or stopping operation still owes a terminal write.

`_write` currently calls `_applied(values)` only while its ticket remains current. Keep that condition for current `heater_set` and LastApplied. Add independent completion evidence for every admitted heater attempt. A superseded transmission still happened and must enter its original journal.

The existing source join omits machine identity, although `roast_sessions` already has `machine_id`, `machine_roaster_key`, and `machine_protocol`. FSD03 extends the join and entity type. No migration is required. The existing TSV contains raw BT, acquisition timestamp, clock, and per-row processing provenance. No new temperature archive is needed.

`useRoastActions` alone cannot send a valid automatic Charge anchor. `RawTemperatureSample` in `features/active-roast/lib/autoCharge.ts` lacks the sensor clock. `useSidecarPolling` constructs it without `sensor_clock`, and `useAutoDetection` passes only BT and a derived browser-wall-time onset. Those callers must carry the actual source key through to `/start`.

## Caller sequence

The existing application creates its roast session ID once. The client then records Charge, inspects status, and sends an explicit curve start after both raw TP gates qualify.

```ts
const charge = await sidecar.startRoast({
    session_id: roastSessionId,
    sensor_clock: status.sensor_clock,
    connection_epoch: status.connection_epoch,
    expected_generation: status.heater_control.generation,
    origin: { kind: 'sample', sample: detectedOnset.sample },
});
const started = await sidecar.pidOn({
    mode: 'curve',
    session_id: roastSessionId,
    charge_id: charge.charge.charge_id,
    request_id: crypto.randomUUID(),
    sensor_clock: status.sensor_clock,
    connection_epoch: status.connection_epoch,
    expected_generation: latestStatus.heater_control.generation,
    machine: currentMachine,
    config_id: 'virtual-v1',
    reference,
});
// Only the visible, responsive control view repeats this call.
await sidecar.pidRenew(started.curve.authority);
await sidecar.pidOff({
    mode: 'curve',
    authority: started.curve.authority,
    reason: 'user',
});
```

The start response never acts as lease renewal when retried. The client uses `/pid/renew` with the returned authority. Fixed callers retain `pidOn(sv)`, `pidOff('hold' | 'zero')`, and `pidSetSv(sv)` compatibility overloads.

## Identity and lifetime

| Identity | Meaning and lifetime |
| --- | --- |
| `session_id` | Existing application roast-session ID. Never minted by a PID toggle. |
| `sensor_clock` | Existing `{32 hexadecimal boot ID}:{connection epoch}` acquisition clock. Changes on process restart or connection change. |
| `charge_id` | Server UUID for one accepted Charge origin. Stable across PID toggles in that roast. Also names the journal session. |
| `request_id` | Client UUID for one explicit control-start intent. Repeated transport delivery uses the same value. A new operator start uses a new value. |
| `run_id` | Server UUID for the admitted PID operation. Terminal once stopped. |
| `generation` | Existing heater-authority generation. Changes synchronously on revocation. |
| `connection_epoch` | Existing connection fence. Used with the boot-qualified sensor clock, never alone across a process restart. |
| `sequence` | Monotonic journal entry sequence within `charge_id`, starting at 1. Runs and terminal reconciliation share that sequence. |

A Charge identifies the batch timeline. A run identifies an explicit control intent on that timeline. Stopping a run does not make its old renewals valid again. A new operator start may create a new run after user-stop, manual takeover, or a recovered nonterminal fault, provided all eligibility checks pass again. The Charge origin stays fixed.

Drop, reset, disconnect, and workspace/session departure close the Charge for curve control. Reference exhaustion closes the run and freezes that run's end reason. It does not invent a physical Drop. A later explicit start can use another eligible reference only while the Charge remains open and before that new reference's end. Process restart cannot recover an open Charge or automatic authority.

Retain terminal run records and accepted request digests during the current Charge. Closing the Charge retains a tombstone with its identity and final cursor until the connection retires. Generation never decreases. Every newly admitted start checks the expected generation. After retirement, the changed boot-qualified clock or connection epoch rejects old requests even if their detailed tombstones were discarded.

Idempotency rules are exact.

1. Identical `/start` for the current `session_id` and origin returns the original Charge. It does not reset filters or notify the adapter again. A conflicting origin is 409.
2. An identical admitted `(charge_id, request_id, canonical request digest)` returns that run's current or terminal snapshot. It does not engage again, extend a lease, or apply heat. Changed content under that request ID is 409.
3. An unseen start request must pass current generation, clock, open-Charge, capability, source, seed, and TP checks before reserving authority.
4. Renewal is accepted only for the exact current `run_id`, generation, epoch, Charge, and sensor clock, strictly before its deadline. Renewal does not create an operation.
5. Duplicate stop for a known terminal run returns its existing terminal result. A delayed stop for an old run never revokes a newer run. A stopping run with an unresolved terminal write still returns pending or uncertain, never completed OFF.
6. A start that fails before admission changes no ownership. A start that fails after admission leaves a terminal or fault operation/tombstone, including any outstanding terminal obligation.

## Wire shapes

Wire names use the existing snake_case convention. All numeric fields are JSON numbers. Booleans, numeric strings, `NaN`, and infinities are rejected in new curve/Charge requests. Legacy `{sv}` retains its current fixed parser. The curve start route accepts at most 8 MiB of JSON so 10,000 full-provenance points fit. Oversize requests return 413 before parsing or admission. IDs and processing-version strings are bounded to 128 characters, clock syntax stays strict, and unknown metadata keys are rejected. `main.create_app` currently uses the default aiohttp body limit, so the implementation must explicitly provide this bounded capacity instead of promising 10,000 points that transport rejects.

```ts
type SampleKey = Readonly<{
    sensor_clock: string;
    acquired_at: number; // Sidecar monotonic seconds, exact returned value.
}>;
type MachineIdentity = Readonly<{
    machine_id: string;
    roaster_key: string;
    protocol: string;
}>;
type ChargeRequest = Readonly<{
    session_id: string;
    sensor_clock: string;
    connection_epoch: number;
    expected_generation: number;
    origin: { kind: 'now' } | { kind: 'sample'; sample: SampleKey };
}>;
type Charge = Readonly<{
    session_id: string;
    charge_id: string;
    machine: MachineIdentity;
    sensor_clock: string;
    connection_epoch: number;
    acquired_at: number; // Authoritative Charge origin, not a claimed measurement.
    anchor: SampleKey | null;
    origin_kind: 'now' | 'sample';
    accepted_at: number;
    state: 'open' | 'closed';
    closed_reason: TerminalReason | null;
}>;
type RawBtPoint = Readonly<{
    elapsed_sec: number;
    acquired_at: number;
    sensor_clock: string;
    bt_c: number;
    processing: TemperatureProcessing; // Existing complete metadata shape.
}>;
type FrozenReference = Readonly<{
    version: 'raw-bt-reference-v1';
    source: 'recorded_session';
    source_session_id: string;
    source_machine: MachineIdentity;
    temperature_unit: 'C';
    control_filter_version: 'raw-bt-dt-ema-v1';
    charge: { event_id: string; elapsed_sec: 0 };
    drop: { event_id: string; elapsed_sec: number };
    points: readonly RawBtPoint[];
}>;
type CurveStartRequest = Readonly<{
    mode: 'curve';
    session_id: string;
    charge_id: string;
    request_id: string;
    sensor_clock: string;
    connection_epoch: number;
    expected_generation: number;
    machine: MachineIdentity;
    config_id: 'virtual-v1';
    reference: FrozenReference;
}>;
type PidStartRequest = { sv: number } | { mode: 'fixed'; sv: number } | CurveStartRequest;
type CurveAuthority = Readonly<{
    session_id: string;
    charge_id: string;
    run_id: string;
    sensor_clock: string;
    connection_epoch: number;
    generation: number;
}>;
type CurveStopRequest = Readonly<{
    mode: 'curve';
    authority: CurveAuthority;
    reason: 'user' | 'drop' | 'view_hidden' | 'workspace_changed';
}>;
type TerminalReason =
    | 'user' | 'manual_takeover' | 'drop' | 'reference_exhausted'
    | 'lease_expired' | 'view_hidden' | 'workspace_changed'
    | 'reset' | 'disconnected' | 'sample_fault' | 'temperature_limit'
    | 'write_fault' | 'start_failed';
```

`TemperatureProcessing` means the existing fields in `shared/types/sidecar.ts`, including `algorithm_version`, Celsius units, monotonic timestamp clock, and display/RoR processing settings. These settings document acquisition provenance. Curve filtering does not reuse their display EMA values.

There is no client `live_tp`, editable TP note, arbitrary gains, output bounds, lease duration, or lookahead in the request. The server derives TP from raw evidence and selects the immutable `virtual-v1` configuration. A source TP event can remain in roast history; it does not grant eligibility.

`reference_digest` is a server SHA-256 over the normalized, validated source contract and configuration ID. It includes raw points, source identity, processing metadata, Charge, and Drop. Object key order does not matter. Point order matters. Unknown new-contract keys are rejected. The digest is provenance and idempotency evidence, not a claim that client data is cryptographically authenticated.

## Charge acceptance and raw-sample history

The session receives each newly acquired raw observation synchronously from manager's existing acquisition path. Cached and stale returns never add a new observation. The session retains a 120-second deque, also capped at 2,048 raw observations. Either bound may evict an anchor. Status reports the oldest retained sample time. There is no additional acquisition loop.

`origin.kind='sample'` requires exact equality with a retained `(sensor_clock, acquired_at)` from the current connection and machine. Its age at acceptance must be at most 120 seconds. A client cannot send elapsed time, browser wall time, or an approximate nearest sample. The sample must have finite raw Celsius BT and valid processing metadata. A missing anchor returns `charge_anchor_missing` without changing the roast origin or heater authority.

`origin.kind='now'` chooses server monotonic acceptance time. It creates no temperature measurement. `anchor` is null. The first actual acquired sample at or after that time seeds control filtering. For a sample-anchored Charge, the retained anchor is that first actual sample and seeds at elapsed zero. Backdated Charge replays retained observations through the pure filter and TP detector once, then continues with new acquisitions.

The response is `{ok:true, charge, server_time, elapsed_sec}`. `server_time` and `elapsed_sec=server_time-charge.acquired_at` come from the same monotonic read. The app stores the accepted origin metadata and aligns its existing wall-time display once from that response. It never computes control elapsed from `Date.now()`. New archived samples for an accepted Charge derive elapsed time from `sensorTimestamp-charge.acquired_at`. This removes UI polling latency from new raw reference timing. The display can still show its existing timer between observations.

An empty legacy `/start` preserves existing ordinary start behavior only when no modern Charge is open. Its response adds `charge:null` and `curve_eligible:false`. It cannot establish or retime a curve-eligible origin. A delayed legacy `/start` during a modern Charge returns 409. The API never silently downgrades a modern Charge to legacy.

Charge acceptance reserves the immutable Charge before notifying an adapter. Duplicate notifications cannot reset its timer. A failed adapter notification returns a failure and leaves that Charge ineligible until explicit reset/new Charge, rather than constructing a new origin on retry. Raw filtering and heater ownership remain independent of scripted simulator notifications.

## Recorded-source eligibility

A valid reference has all of these properties.

- A real session archive source, a nonempty source session ID, and complete saved machine identity. Source and connected machine identity match exactly. Source identity is never inferred from the current UI selection. A virtual fixture must explicitly provide matching synthetic identity in its declared test setup.
- Explicit Charge and Drop event IDs with `Charge=0 < Drop <= 1,800 seconds`. No duration fallback substitutes for Drop.
- Between 10 and 10,000 acquired points. The first acquired point is at or after Charge and within 3 seconds. All submitted points are at or before Drop.
- Every point has finite raw BT in `[0,260] C`, a finite acquisition time, finite elapsed time, complete recognized processing metadata, and one valid sensor clock. The initially supported measurement algorithm is the existing `ema-least-squares-v1`.
- Both acquisition and elapsed times strictly increase. Each adjacent gap is at most 3 seconds in both domains. Duplicate acquisition identities are rejected, even when received at different UI times.
- Let `offset_i=acquired_at_i-elapsed_sec_i`. All offsets differ from the first by at most 1 second. This admits existing receipt-time archive jitter but rejects retiming or clock discontinuities. New accepted-Charge archives use the exact common origin, apart from existing TSV elapsed rounding to two decimals. No points are resampled to repair a bad archive.
- Raw evidence produces a nonfallback TP under the same detector used live. UI fallback notes and historical TP labels cannot substitute.
- The last acquired point is within 3 seconds before explicit Drop. `target_end_sec` is the last acquired point's elapsed time. At that boundary the run terminates `reference_exhausted`. It never extrapolates to an unsampled Drop or holds the last target indefinitely. This can stop up to 3 seconds before the recorded Drop mark. It preserves the explicit Drop upper bound without inventing a measurement.
- Filtered targets used after qualification are within the existing fixed target range `[50,250] C`. An out-of-range future target rejects the whole reference before admission.

`useResolvedProfileCurve` has synthetic fallback and is not an FSD reference source. FSD03 uses the real TSV query/source and source events. The existing general TSV parser is deliberately tolerant. A control-reference builder must additionally detect malformed, missing, or skipped measurement rows instead of inheriting silent chart repair. It must not drop bad rows and then present the remaining sequence as complete.

There is one explicit chart-seed exclusion. `useSidecarPolling.ts` creates a leading `time=0` chart point whose acquisition timestamp and clock are both null. The builder may exclude exactly that leading zero-time row when both provenance fields are absent and all subsequent acquired rows satisfy this contract. It records that exclusion in reference-build diagnostics. The row never contributes BT, TP, filter seed, or interpolation. A missing field on any other row rejects the source. A second such row rejects the source. New accepted sample-anchored Charge paths use their real acquired anchor as the seed and retain its provenance. A manual-now Charge waits for its first acquired sample.

Pre-Charge and post-Drop archive sections may be explicitly sliced by their recorded Charge/Drop boundaries before constructing the frozen payload. That operation does not discard malformed rows inside the selected interval. The sidecar rejects any post-Drop row submitted to it.

## Pure numerical contract

`roast_target.py` owns substantive parsing, the frozen target, raw TP qualification, filter progression, and bounded interpolation. It imports no manager, adapter, HTTP, asyncio, or UI module.

```python
@dataclass(frozen=True)
class RawObservation:
    clock: str
    acquired_at: float
    elapsed_sec: float
    bt_c: float

@dataclass(frozen=True)
class QualifiedTp:
    minimum_elapsed_sec: float
    confirmed_elapsed_sec: float
    minimum_bt_c: float

@dataclass(frozen=True)
class RoastTarget:
    digest: str
    source_session_id: str
    source_machine: MachineIdentity
    points: tuple[RawObservation, ...]
    filtered: tuple[float, ...]
    tp: QualifiedTp
    drop_sec: float
    end_sec: float

    def at(self, elapsed_sec: float) -> float:
        # Linear interpolation inside support only. No extrapolation.
        raise NotImplementedError

def parse_target(value: object, *, machine: MachineIdentity,
                 config: CurveConfig) -> RoastTarget:
    raise NotImplementedError

def advance_filter(state: ControlFilter | None,
                   sample: RawObservation) -> ControlFilter:
    raise NotImplementedError

def advance_tp(state: RawTpState, sample: RawObservation) -> RawTpState:
    raise NotImplementedError
```

The immutable Python records contain validated domain values. Wire dictionaries do not propagate to the runner. The control filter's version is `raw-bt-dt-ema-v1`. It seeds from the first genuinely acquired raw sample at or after accepted Charge. Each subsequent accepted sample uses `alpha=1-exp(-acquisition_dt/2)` without rounding. Duplicate identities do nothing. Warmup is 10 seconds of contiguous acquisition time after the seed, with no gap greater than 3 seconds. Reference and live use this exact function at their actual acquisition cadence, including irregular intervals.

Raw TP uses no control/display filter. It tracks the running minimum after Charge and at least a 5 C descent from the first acquired Charge-side baseline. The minimum must occur at elapsed time at least 20 seconds. A qualifying recovery begins at the first sample at least 2 C above that minimum. Every subsequent accepted sample must remain at least 2 C above the minimum for at least 5 acquisition seconds, with no gap greater than 3 seconds. A lower minimum resets recovery. A dip below the recovery threshold resets its duration. Equal minima use the latest equal-minimum time, so a plateau cannot qualify early. Confirmation records both the actual minimum time and the later confirmation time. There is no timeout fallback.

A live gap over 3 seconds resets the filter's warmup and any unconfirmed TP evidence. Confirmed TP evidence remains a historical fact for the same Charge/clock. A connection/clock change invalidates the Charge instead. During an active run, the gap enters HOLDING. Five seconds of unresolved hold leads to `sample_fault`. Because rewarm takes 10 seconds, a gap-reset run cannot silently resume before that timeout. After rewarm, a new explicit operator start can create a new run if the Charge remains open. This is a deliberate consequence of the frozen constants, not an implementation accident.

Start requires fresh raw evidence, completed live warmup, confirmed live TP, elapsed time at or beyond the reference TP confirmation time, valid target support, and absolute initial target-minus-filtered-PV error at most 10 C. The comparison uses the current sidecar Charge elapsed time. No TP time shift is applied. Before engagement, Gas stays manual.

## PID progression and output bounds

Extend the existing `SoftwarePid.update(pv, acquired_at, *, output_bounds=None)`. Omitted bounds preserve fixed behavior. Curve mode intersects absolute `[0,100]` bounds with the last successfully transmitted logical command plus/minus `5 * elapsed_seconds_since_that_command`. The start seed is the current connection's last successfully applied logical Heat set, or fresh valid percent feedback if none exists. Missing, nonfinite, wrong-unit, or uncertain seeds reject curve engagement. Fixed engagement keeps its current fallback behavior.

The update computes P/I/D, computes requested output, clamps once to the effective actuator bounds, then runs the existing back-calculation against that permitted output. Conditional integration tests saturation against the previous effective bounds in curve mode. Integral clamping remains based on the absolute output band. A narrow slew window must not shrink the allowed integral band. Low-Ki handling and derivative-on-measurement remain intact. Do not implement slew by changing `out_min/out_max` each tick or by clamping after back-calculation.

Curve mode uses no duty deadband and resends once per accepted control tick. This keeps the permitted numerical command and the command sent to the virtual actuator aligned. Fixed mode retains its existing deadband/resend defaults. A failed or uncertain curve command does not advance the last-applied slew baseline. The run enters its terminal error path without integrating more work against an unknown actuator state.

The session uses the existing runner and one control task. Curve ticks use absolute one-second deadlines and skip missed deadlines. They do not replay a burst. Reference lookup uses sidecar `now-charge.acquired_at` with zero lookahead. Filter and PID dt use acquisition time. Each fresh identity enters the filter once and the PID at most once. Cached reads cannot advance filter warmup, TP, or integral. Every post-await path rechecks operation identity and lease validity before it can write or change current runtime state.

The terminal minimum is logical heater 0 for `virtual-v1`. Terminal minimum and an explicit manual takeover command are not subject to curve slew limits. Ordinary regulation stays bounded. A logical command is never described as observed flame state or physical fuel cutoff.

## Operation, lease, and terminal barriers

The private shape extends the existing `PidOperation` with a discriminated payload.

```python
@dataclass(frozen=True)
class FixedOperation:
    pass

@dataclass(frozen=True)
class CurveOperation:
    charge_id: str
    request_id: str
    run_id: str
    target: RoastTarget
    config: CurveConfig
    lease_deadline: float

@dataclass(frozen=True)
class PidOperation:
    ticket: HeaterTicket
    runner: PidRunner
    phase: Literal['starting', 'active', 'stopping', 'fault']
    mode: FixedOperation | CurveOperation
```

This sketch retains one `_operation` owner. Mutable renewal replaces its immutable curve payload. A stopping/fault operation retains its original run metadata and terminal obligation even if the runner reports OFF. History/tombstones are immutable outcomes, not alternative live owners.

Admission parses and validates everything first, then atomically checks and reserves the current operation before the first await. Initial lease expiry is admission time plus 3 seconds. The watchdog is scheduled immediately, including during starting. Existing drain/feedback awaits cannot postpone its deadline. Renew extends a still-live deadline to server acceptance time plus 3 seconds. The UI renews every second while its control view is visible, mounted, and healthy.

Authority validity includes `monotonic_now < lease_deadline`. The independent watchdog revokes at expiry without acquiring the manager read lock, waiting for a read, waiting for the runner, or waiting for a writer. Driver admission predicates also reject an expired ticket, even if the watchdog callback has not yet run. The watchdog then schedules the same session terminal path. A blocked native read/write can delay the terminal command, but cannot extend automatic authority. A fully stalled process cannot run its scheduler; no independent hardware safety claim follows.

All curve ends reserve terminal authority synchronously, cancel future regulation, retain already-started writes, and then drain the existing writer barrier. The terminal minimum runs through that same writer. Only the current terminal operation may clear itself or publish completed OFF. It checks ownership after every await. An obsolete finalize callback cannot mint a new safety ticket or zero a newer run.

The existing two-second writer/barrier timeout remains a timeout on acknowledgement, not a cancellation of physical I/O. Timeout returns 504 with uncertainty, leaves the operation stopping/fault, and retains its writer completion observation. Later completion appends reconciliation. It does not retroactively make the earlier response a success. New automatic ownership remains blocked while the retained outcome is uncertain.

Manual takeover revokes the curve run and drains old work before its own manual write. Its command supersedes that run's minimum obligation only after the takeover succeeds. Failure or timeout must retain a visible unresolved terminal obligation; it must not erase `_operation` before the old run's terminal outcome is established. Automatic reconnect on the same adapter retains the required minimum. Explicit connection retirement closes admission, drains, then retires the operation so old work cannot write a new adapter. These preserve the FSD01 operation and connection fixes.

## Endpoints and status

| Endpoint | Request and behavior |
| --- | --- |
| `POST /start` | Optional `ChargeRequest`. Returns accepted Charge and authoritative elapsed. Empty legacy form remains curve-ineligible. |
| `POST /pid/on` | `PidStartRequest`. Fixed replies retain `{ok,pid}`. Curve replies add `curve` and `server_time`. Identical retries return the same operation snapshot. |
| `POST /pid/renew` | Exact `CurveAuthority`. Returns `{ok,authority,server_time,lease_deadline}`. Terminal, expired, or foreign identity is 409. |
| `POST /pid/off` | Legacy empty/hold/zero form for fixed control, or `CurveStopRequest`. Curve termination always uses virtual minimum. |
| `POST /pid/sv` | Existing fixed request only. Curve ownership returns 409 without changing its frozen target. |
| `GET /status` | Existing fields plus capability, current Charge, current/last curve snapshot, and server monotonic time. Available with no active runner. |
| `GET /temperatures` | Existing fields unchanged. Adds the same current curve snapshot when one exists; freshness of this payload does not renew authority. |
| `GET /pid/receipts?charge_id=...&after=...&limit=...` | Session-qualified immutable journal page. Default limit 256, maximum 512. `after=0` asks from the first entry. |

A nonempty malformed JSON body returns 400 before ownership changes, including `/pid/off`; it cannot be interpreted as a bodyless stop. Valid legacy stop commands remain accepted. An unbound legacy stop during curve ownership stops the current curve using its minimum policy. FSD03 always sends bound stops so delayed modern requests cannot stop a later run.

Existing `PidRuntime` fields retain their meaning for fixed callers. New curve-specific data is a distinct `curve` object, never inferred from `pid.state`. The status type is concrete.

```ts
type CurveSnapshot = Readonly<{
    mode: 'curve';
    authority: CurveAuthority;
    request_id: string;
    phase: 'starting' | 'active' | 'stopping' | 'fault' | 'terminal';
    runner_state: 'off' | 'running' | 'holding' | 'fault';
    reason: TerminalReason | null;
    terminal_outcome: 'none' | 'pending' | 'completed' | 'uncertain' | 'failed';
    config_id: 'virtual-v1';
    reference_digest: string;
    source_session_id: string;
    control_filter_version: 'raw-bt-dt-ema-v1';
    elapsed_sec: number;
    target_bt_c: number | null;
    control_pv_c: number | null;
    error_c: number | null; // target minus control PV.
    sample: SampleKey | null;
    sample_age_sec: number | null;
    warmup_remaining_sec: number;
    live_tp: QualifiedTp | null;
    reference_tp: QualifiedTp;
    reference_drop_sec: number;
    target_end_sec: number;
    requested_heat_set: number | null; // P+I+D before actuator bounds.
    permitted_heat_set: number | null;
    last_applied_heat_set: number | null;
    heat_feedback: number | null;
    lease_deadline: number | null;
    pending_writes: number;
    uncertain: boolean;
    receipt_next_sequence: number;
}>;
type QualifiedTp = Readonly<{
    minimum_elapsed_sec: number;
    confirmed_elapsed_sec: number;
    minimum_bt_c: number;
}>;
type CurveCapability = Readonly<{
    supported: boolean;
    reason: 'ready' | 'physical_unqualified' | 'scripted_virtual'
        | 'machine_identity_missing' | 'heater_unavailable';
    config_id: 'virtual-v1' | null;
}>;
type CurveEligibility = Readonly<{
    eligible: boolean;
    reason: 'ready' | 'no_charge' | 'charge_closed' | 'sample_stale'
        | 'warming' | 'live_tp_pending' | 'connection_changed';
    warmup_remaining_sec: number;
    live_tp: QualifiedTp | null;
}>;
```

`/status` adds `server_time`, `sensor_clock`, `charge: Charge|null`, `curve: CurveSnapshot|null`, `curve_eligibility`, `charge_history_oldest_at:number|null`, and `control.pid.curve:CurveCapability`. Eligibility without a submitted reference covers only live conditions. Start validation additionally checks reference TP, error, support, and identity. `heater_control` remains the current global owner snapshot. A historical terminal curve's authority can differ from that current owner.

All physical adapters report `curve.supported=false`. `virtual-v1` also requires the actual virtual thermal adapter mode, percent-writable heater, and explicit machine identity. Scripted virtual BT reports unsupported because it does not respond to the controller. The existing default virtual demo mode is not silently changed.

The existing public connect path already accepts a thermal fixture without a product setting. `main.handle_connect` forwards all remaining parameters to `manager.connect`, `_merge_connect_params` preserves `sim`, and `make_adapter` passes it to `VirtualMachineAdapter`. The concrete request is:

```json
{"roaster":"virtual","machine_id":"fsd-virtual-fixture","sim":"thermal"}
```

The smallest capability gate is `protocol == "virtual"`, merged `sim == "thermal"`, known machine identity, and existing writable-percent-heater checks. No new simulation endpoint or simulator configuration form is required. Both protocol form registries currently have `virtual: []`, and the frontend virtual defaults contain only `mode: "C"`. Ordinary UI creation therefore cannot select thermal mode today. For the isolated live UI fixture, seed a virtual machine's existing `connectionParams` with `{sim:"thermal"}` and its explicit fixture machine ID. `features/machine-connection/model/useMachineSidecarConnection.ts:156` sends those parameters unchanged through `sidecar.connect`. Alternatively, connect that exact machine ID through the existing public API before the UI adopts `/status`. The fixture must retain the causal thermal connection rather than reconnecting with default scripted parameters. This is declared test preparation, not a claim of a new user-facing setting.

Errors preserve existing `error` text and add a stable `code`, optional `field`, and `uncertain` where applicable. Codes include `invalid_request`, `invalid_reference`, `unsupported_curve`, `machine_mismatch`, `charge_anchor_missing`, `charge_conflict`, `stale_authority`, `request_conflict`, `charge_closed`, `tp_pending`, `filter_warming`, `initial_error`, `seed_unavailable`, `reference_exhausted`, and `write_uncertain`. Malformed input and source validation are 400, runtime/capability/ownership conflicts are 409, retained-write uncertainty is 504, and transport failure is 502 under the existing error-reporting policy. Validation failures do not enter hardware-failure capture.

## Immutable receipt contract

Each admitted heater attempt gets its original Charge/run/ticket metadata before the writer starts. A logical attempt and its observations are separate immutable journal entries. The bounded journal holds the latest 2,048 entries. It does not silently rewrite an uncertain entry when I/O later completes.

```ts
type CommandReceipt = Readonly<{
    session_id: string;
    charge_id: string;
    sequence: number;
    attempt_sequence: number; // The initial attempt entry's sequence.
    run_id: string | null;
    generation: number;
    connection_epoch: number;
    sensor_clock: string;
    origin: 'manual' | 'replay' | 'pid' | 'safety';
    purpose: 'regulate' | 'terminal' | 'manual' | 'replay';
    event: 'attempt' | 'transmitted' | 'completed' | 'rejected'
        | 'uncertain' | 'reconciliation';
    observed_at: number;
    elapsed_sec: number;
    sample: SampleKey | null;
    raw_bt_c: number | null;
    control_pv_c: number | null;
    target_bt_c: number | null;
    requested_heat_set: number;
    permitted_heat_set: number;
    acknowledged_heat_set: number | null;
    evidence: 'none' | 'virtual_applied' | 'transport_sent'
        | 'register_written' | 'register_readback';
    outcome: 'pending' | 'succeeded' | 'rejected' | 'uncertain' | 'failed';
    reconciles_sequence: number | null;
    reason: string | null; // Stable code, no user text or secret.
}>;
type ReceiptPage = Readonly<{
    session_id: string;
    charge_id: string;
    first_available: number;
    next_sequence: number; // Global high-water plus one at this snapshot.
    next_after: number; // Last returned sequence, or the supplied cursor.
    has_more: boolean;
    gap: { from: number; through: number } | null;
    receipts: readonly CommandReceipt[];
}>;
```

The cursor key is `(charge_id, sequence)`. `charge_id` is the server-issued journal-session identity and prevents a process restart from colliding with already saved `(application session ID, sequence)` pairs. The application roast `session_id` remains on every receipt for existing event persistence. Runs within one Charge share a journal, so terminal and manual-takeover commands remain recoverable after the PID run ends.

The initial attempt entry has `attempt_sequence=sequence`, `event=attempt`, `outcome=pending`, and no acknowledgement. Every transport retry creates a new attempt and is never erased by deduplication. Boundary-rejected requests have no admitted attempt and do not mutate the journal or owner. A queued attempt fenced before transmission can append a rejected observation. A timeout appends uncertainty. Later actual completion appends reconciliation referring to that uncertainty sequence, including when the attempt's authority is obsolete.

Adapters need a small private heater-I/O observer or equivalent typed result that reports the actual heater step. Merely waiting for the whole mixed-role `control()` result is insufficient: heater may succeed and a later fan step may fail. S7 reports register-write completion and, when available, register readback. Probat reports WebSocket transport send. Virtual reports its accepted mutation. Observation happens at the real operation, not at queuing or scheduling. A thrown transport error after possible transmission means uncertainty unless the adapter proves no heater transmission occurred. An early emitted transmitted observation survives later failure.

A session observer bound to the original immutable attempt records every transmission/completion, regardless of current authority. The existing `_applied` update remains current-only. Both are needed. A late obsolete command can enter its historical receipt journal without overwriting the newer owner's LastApplied.

Journal append happens on the event loop. A thread-based S7 observer transfers its immutable fact through `call_soon_threadsafe`; it does not mutate journal state from the executor thread. Writer completion is not acknowledged until its associated observations are queued/processed in order. No observer grants heater authority, creates a writer, or performs reconciliation writes.

For a cursor behind retention, `gap` names the missing inclusive sequence range. The page still returns retained records after the requested position. A future cursor is 400. An unknown/retired Charge returns 410 `journal_unavailable`, never an empty complete history. Reading status or receipts never renews a lease.

FSD03 persists receipt metadata in existing `StoredRoastEvent`/`applied_control` paths, deduplicated by `(charge_id, sequence)`. It stores uncertainty and reconciliation as separate entries. Rendering resolves the latest known observation without rewriting the archive. Heat feedback remains separate. Drop does not delete post-Drop terminal receipts or clamp their elapsed time to Drop. Before save, the collector drains available pages through a known cursor. It records unresolved attempts, missing ranges, and `journal_unavailable` explicitly if complete recovery is impossible. Late reconciliation after an initial save is merged into the same session's existing events through the existing save/update path. No new DB table, temperature archive, or fabricated sampled-PID command history is introduced.

## File ownership and implementation order

The contract can be implemented with two independent owners after root accepts it. No parallel production edits occur during this refinement.

| Owner | Files and callers |
| --- | --- |
| Pure target/math | New `src-tauri/sidecar/roast_target.py`, existing `pid.py`, new `tests/test_roast_target.py`, existing `tests/test_pid.py`. Own parsing, immutable data, TP/filter/interpolation, effective bounds and numerical fixtures. |
| Session/protocol | `heater_control_session.py`, `pid_runner.py`, `manager.py`, `main.py`, `config.py`, `control_guard.py` only for boundary DTO adaptation where appropriate, and their API/session/runner tests. Own the one operation, acquisition observation, Charge, lease, status, journals, and fences. |
| Session owner, sequential driver follow-up | `adapters/s7.py`, `adapters/probat_ws.py`, `adapters/virtual.py`, and adapter tests. Add per-heater factual I/O observations through existing writers. Do not add a second serialization path. |
| Shared protocol and minimum FSD02 caller plumbing | `shared/types/sidecar.ts`, `shared/lib/sidecar.ts`, machine type re-exports, `features/active-roast/lib/autoCharge.ts`, `model/useAutoDetection.ts`, `model/useRoastActions.ts`, and `views/active-roast/model/useSidecarPolling.ts`, plus their fixtures/tests. Preserve clock/anchor through the existing callbacks. Carry accepted Charge timing in existing roast state and use it for new archived sample elapsed time. |
| FSD03 integration | Existing roast-profile API/entity join/query exports, a pure recorded-reference builder and tests in that slice, existing machine-control composition and view, shared roast event types, serializers/parsers, `useSaveRoast`, `ActiveRoastRuntime`, and History consumers. The persistent runtime collects receipts but cannot renew leases. |
| Evidence and docs | Existing `tests/test_pid_virtual_e2e.py`, `scripts/verify-fsd.py`, `docs/sidecar-api.md`, and the plan's ten live lanes and timing driver. |

Keep `manager.pid_start` and `pid_stop` as compatibility adapters. Session extends `start_curve`, `charge`, `renew`, `receipts`, and a single operation-aware status serializer. The runner accepts either fixed mode or a validated curve context, uses the same numerical PID, and returns its fault/terminal condition to the session's existing authority path. It cannot own Charge, renew itself, select a machine, or replace the session's operation.

Pure work can proceed independently against these signatures. Session/protocol and driver work share `_write` and callback behavior, so they stay with one owner or run sequentially. Frontend implementation follows the frozen wire types; it must not infer eligibility from the chart or pass a sibling feature's internals across FSD boundaries.

## Deterministic fixture evidence and remaining gates

The external [probe](/Users/hanseungheon/.codex/agent-store/first-crack/docs/fsd02-contract/probe_contract.py) loads the real `SoftwarePid` source and `FirstOrderThermalModel` from the grounding commit. It changes only the optional output-bound clamp before the existing back-calculation, in memory. It does not change repository code, open a socket, or instantiate hardware. Its [results](/Users/hanseungheon/.codex/agent-store/first-crack/docs/fsd02-contract/fixture-results.json) include source SHA-256 and every numerical row. The prototype preserves original conditional integration; the production contract also adds previous-effective-bound saturation to curve integration, so final production results must be rerun.

The declared saturation fixture has 600 one-second samples, seed 216, plant `tau=40`, `heater_gain=2.4`, ambient 25 C, and initial BT 150 C. The control filter has tau 2 seconds. Initial duty is `(150-25)/2.4`. Target is 150 C except seconds 20 through 79, when target is 250 C. It returns to 150 C at second 80. Noise is uniform in ±0.3 C for the delayed/noisy case and zero otherwise. The delay is a two-sample observation delay. These are synthetic model conditions, not measured machine conditions.

The declared acceptance criterion is finite commands in `[0,100]`, command slew at most 5 percentage points per second, integral in `[0,100]`, observed saturation, return to absolute filtered target error at most 5 C for 30 consecutive seconds within 120 seconds of the downward target step, and final-60-second error RMSE at most 1 C.

| Case | Recovery start after target step | Final 60-second error RMSE |
| --- | --- | --- |
| Virtual gains `4,0.3,2`, no noise/delay | 35 s | 0 C |
| Virtual gains `4,0.3,2`, noise ±0.3 C, 2 s observation delay | 35 s | 0.1253 C |
| Low-Ki regression gains `20,0.01,3`, no noise/delay | 60 s | 0.1951 C |

All three reached duty 100 and passed the criterion. This resolves a reproducible saturation-recovery criterion without physical tuning. It does not prove production runner admission, PID scheduling, reference tracking, stale-read behavior, receipt completion, or lease timing.

The separate raw TP preparation fixture starts at BT 150 C, applies manual duty 0 for 30 seconds, then manual duty 60. The real thermal model reaches its minimum 83.4855 C at second 30 and qualifies the raw recovery at second 36. The UI run must create this kind of actual cooling and recovery. With the unchanged thermal adapter, begin at its real ambient state, manually preheat until the observed BT reaches the declared start range, accept Charge, lower duty for the declared cooling interval, then restore manual duty and wait for observed raw TP confirmation. Record the actual initial BT and sample clock. An isolated fixture may instead initialize the real thermal model to the declared BT before connection, but must label that setup. Scripted demo BT is not closed-loop proof.

Implementation acceptance still requires these empirical gates.

1. Run the exact FSD01 capture at the final local source, then retain fixed/manual/Replay compatibility in the FSD02 regression lane.
2. Verify the pure parser/filter/TP with irregular cadence, gap reset, duplicate identities, first genuine sample, chart-seed exclusion, rounding, clock changes, and explicit Drop tail behavior.
3. Test all lifecycle schedules against the real session, including expiry during initial feedback, blocked read, queued write, started write, delayed obsolete completion, manual takeover, zero-stop while starting, stop supersession, and connection retirement.
4. Run the real virtual sidecar with a real-format recorded raw reference and declared thermal preparation. Show bounded target-following, sidecar-owned elapsed time, both TP gates, and reference exhaustion. A pure numerical probe cannot substitute for this lane.
5. Rerun the declared saturation criterion with production math and runner. Add rising reference/noisy/delayed closed-loop cases without changing the fixture thresholds after observing a failure.
6. Prove journal ordering, mixed-role partial transmission, timeout followed by reconciliation, polling recovery, overflow gap, terminal receipt after Drop, save/reopen deduplication, and restart cursor collision prevention.
7. Run the plan's 600-tick evaluator and separate 60-second real-time cadence trials. Measure the proposed p99 target lookup below 5 ms, added p95 scheduling lateness below 50 ms, and lease revocation no later than deadline plus 250 ms under isolated virtual load. Logical admission must still reject a deadline-expired ticket immediately. No timing measurements were taken by this refinement.
8. In FSD03, prove visible-view lease renewal stops on hidden view, error boundary, workspace departure, and UI failure while collection remains alive. Preserve stop/status access after entitlement loss.

## Material choices

Model the Domain keeps one `PidOperation` owner and separates batch Charge identity from control-run identity. Boundary Discipline keeps validation in pure parsing before ownership mutation. Make Operations Idempotent preserves Charge and run outcomes across duplicate requests and late callbacks. These choices apply the read [domain](/Users/hanseungheon/.codex/skills/principle-model-the-domain/SKILL.md), [boundary](/Users/hanseungheon/.codex/skills/principle-boundary-discipline/SKILL.md), and [idempotency](/Users/hanseungheon/.codex/skills/principle-make-operations-idempotent/SKILL.md) principles.

Strict provenance means some existing archives remain ineligible. The only compatibility exclusion is the recognizable chart-only Charge seed. A reference can stop up to 3 seconds before its Drop mark because no unsampled endpoint is invented. A gap resets a 10-second filter warmup and therefore cannot recover within the five-second active hold window. These behaviors are explicit so FSD03 can show the actual reason instead of guessing.

No physical qualification, hardware command, publication, source edit, or UI acceptance is claimed. New configuration options, a second controller, a new temperature archive, and a database migration are omitted.
