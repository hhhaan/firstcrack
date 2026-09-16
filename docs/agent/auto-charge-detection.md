# Auto Charge detection (#448)

## Failure and scope

The old detector required a 5°C (customer: 7°C) fall inside 2.5 seconds and
consumed the display EMA. At 1s polling its retained span could be only 2s;
a 1–3°C/s charge could never satisfy 7°C even without EMA lag.

Charge now compares the raw BT slope before and after a bend.
Drop retains its existing display-BT 2.5s window, 8°C default threshold,
180s gate and lookback. Drop improvements are tracked in [#459](https://github.com/hhhaan/firstcrack/issues/459),
with Artisan as the primary reference.
Chart, TP/Yellow detection and TSV retain their existing display series.
TSV backfill, display EMA reset at startRoast, and fallback-TP alarm gating
are separate issues, not solved here.

## Input and decision

- `/temperatures.bt_raw` is the validated, unsmoothed sensor BT. `bt` remains
  the display EMA. The frontend applies the existing BT glitch filter to each
  stream separately; invalid raw samples clear the detector history.
- Sensor `timestamp` supplies elapsed time, including unchanged integer BT
  readings. UI timer ticks and repeated timestamps do not add samples.
- Stale/missing raw data, a phase change, a backwards clock or a gap over
  2.5s clears history. Older sidecars without raw BT cannot auto-detect Charge;
  manual Charge and existing automatic/manual Drop remain available. Ship frontend and sidecar together.
- Compare two pre-bend and two post-bend intervals in °C/s. Both post-bend
  intervals must exceed the configured falling rate. The fall must exceed
  `offset + 2.5 * abs(previous slope)`, or reverse a rising slope by more
  than 0.78°C/s. This rejects ongoing steady cooling rather than accumulating it.
- Evaluate adjacent samples and every second sample (11 retained points) for
  quantized probes. Actual timestamps normalize both 500ms and 1000ms polling.
- Charge default: 0.67°C/s; offset 0.5°C/s.
  These use Artisan Standard's 1s reference values, not W60A measurements.
  Unlike Artisan's sampling buckets, rates here use actual time intervals;
  there is no cap that lets an already-steep steady fall become a new event.
- Charge requires standby (Charge Wait) and BT above 77°C.
  Manual exclusion and the once-per-batch latch remain.
- Mark the higher point bordering the bend (last plateau point on a tie).
  Convert its sensor-time lag to the current sample's reception wall clock.
  This preserves existing event/session clock semantics; it does not remove
  transport latency from the recording time axis.

References: [Artisan parameters](https://github.com/artisan-roaster-scope/artisan/blob/master/src/artisanlib/canvas.py)
and [checkTop / BTbreak](https://github.com/artisan-roaster-scope/artisan/blob/master/src/artisanlib/main.py).

## Settings and field validation

`autoChargeMinRateCPerSec` is a new setting (0.1–15°C/s). Legacy
`autoChargeDropC`, including the customer's 7°C, is ignored, never interpreted
as a rate. `autoDropDropC` retains its stored value and °C units. The Charge settings UI
explains the replacement in all four locales and always labels rates °C/s.

Synthetic tests cover 1–3°C/s drops, both polling rates with jitter, integer
probes, drift, isolated spikes, stale/duplicate/invalid samples, clock resets,
phase gates and manual exclusion. Drop regression coverage verifies that its
existing display-BT threshold and 180s gate remain unchanged. They do not establish W60A
field accuracy. Still collect actual charge BT/TSV, batch weight, polling
interval, manual Charge behavior and the phase at charge (READY entered?).
