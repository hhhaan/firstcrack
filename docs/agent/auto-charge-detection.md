# Auto Charge / Drop detection (#448, #459)

## Failure and scope

The old detectors required a 5–8°C fall inside 2.5 seconds and consumed the
display EMA. At 1s polling the retained span could be only 2s; a 1–3°C/s
charge or a slower dump could never satisfy the window even without EMA lag.

Charge and Drop now compare the raw BT slope before and after a bend
(`checkTop` / `BTbreak`). Chart, TP/Yellow detection and TSV retain the
display series. TSV backfill, display EMA reset at startRoast, and fallback-TP
alarm gating are separate issues.

## Input and decision

- `/temperatures.bt_raw` is the validated, unsmoothed sensor BT. `bt` remains
  the display EMA. The frontend applies the existing BT glitch filter to each
  stream separately; invalid raw samples clear the detector history.
- Sensor `timestamp` supplies elapsed time, including unchanged integer BT
  readings. UI timer ticks and repeated timestamps do not add samples.
- Stale/missing raw data, a phase change, a backwards clock or a gap over
  2.5s clears history. Older sidecars without raw BT cannot auto-detect Charge
  or Drop; manual Charge and manual Drop remain available.
- Compare two pre-bend and two post-bend intervals in °C/s. Both post-bend
  intervals must exceed the configured falling rate. The fall must exceed
  `offset + 2.5 * abs(previous slope)`, or reverse a rising slope by more
  than 0.78°C/s. This rejects ongoing steady cooling rather than accumulating it.
- Evaluate adjacent samples and every second sample (11 retained points) for
  quantized probes. Actual timestamps normalize both 500ms and 1000ms polling.
- Charge Standard 1s: 0.67°C/s, offset 0.5°C/s, BT > 77°C, standby (Charge Wait).
- Drop Standard 1s: 0.34°C/s, offset 0.2°C/s, BT > 160°C, roasting, Charge+7 min.
  These use Artisan Standard's 1s reference values, not W60A measurements.
  Unlike Artisan's sampling buckets, rates here use actual time intervals;
  there is no cap that lets an already-steep steady fall become a new event.
- Drop-only (not Artisan `BTbreak`): Standard waits one more sample and requires 2°C
  below the bend, so a 1°C dip that recovers does not mark Drop or stop PID.
  Sensitive only rejects a recovering next sample. A ≥8°C step that then holds
  is a Drop even when the second post-bend leg is flat; a rejected over-rate
  sample is kept so the following confirmed step still sees the plateau.
- Mark the higher point bordering the bend (last plateau point on a tie).
  Convert its sensor-time lag to the current sample's reception wall clock.
  This preserves existing event/session clock semantics; it does not remove
  transport latency from the recording time axis.
- Manual Charge / Drop set the once-per-batch latch. Undo of Drop does not
  re-arm auto Drop (Artisan `autoDROPenabled=False`). A new batch
  `resetAutoDetection` re-arms both.

## Settings

`autoChargeMode` / `autoDropMode` are Standard or Sensitive. Legacy
`autoChargeDropC` and `autoDropDropC` (including stored °C thresholds) are
ignored, never interpreted as a rate. The settings UI explains the replacement
in all four locales.

References: [Artisan parameters](https://github.com/artisan-roaster-scope/artisan/blob/master/src/artisanlib/canvas.py)
and [checkTop / BTbreak](https://github.com/artisan-roaster-scope/artisan/blob/master/src/artisanlib/main.py).

Synthetic tests cover 1–3°C/s onsets, both polling rates with jitter, integer
probes, drift, isolated spikes, stale/duplicate/invalid samples, clock resets,
phase gates and manual exclusion. They do not establish W60A field accuracy.
Still collect actual charge/drop BT/TSV, batch weight, polling interval, and
manual vs auto marks.
