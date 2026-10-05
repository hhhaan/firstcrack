# Raw BT automatic event detection

## Input and clocks

- `/temperatures.bt_raw` is the unsmoothed sensor input; `bt` is the independently configurable display EMA. Automatic event detection never uses the display smoothing setting.
- Charge/Drop consume each `rawTemperature` response synchronously. Sensor timestamps, including repeated integer temperatures with a new timestamp, supply elapsed time. Duplicate/out-of-order timestamps and bursts shorter than half a poll interval are ignored.
- Invalid/stale/missing raw data, phase/connection/machine changes and gaps longer than three nominal poll intervals reset Charge/Drop. A new batch resets fired latches; manual marks disable automatic marks for that batch. Undo Drop does not re-arm it.
- TP/Yellow use recorded `btRaw`, retain missing/rejected readings as discontinuities, and use `sensorTimestamp`/`sensorClock` to exclude duplicates and clock changes. Older raw recordings without these fields use recording time. Neither event can confirm across a gap longer than 1.5 poll intervals, while disconnected/reconnecting, or from an old last observation.
- The shared BT range/rate filter rejects invalid values and single large spikes. A held downward step followed by a consistent raw reading can be restored to Charge/Drop history; recording remains unchanged.
- Sidecars without raw BT cannot auto-detect events; manual marks remain available.

## Charge / Drop

Artisan `checkTop`/`BTbreak` supplies the bend comparison: two falling legs after a bend must beat the previous slope, with tight and every-second-sample checks for quantized probes. Actual timestamps normalize rates, rather than relying only on Artisan's sampling buckets.

- Standard Charge falling leg: approximately 0.67°C/s; onset BT >77°C.
- Standard Drop falling leg: 0.34°C/s at both polling rates; onset BT >160°C. Only samples after `elapsed > autoDropStartMin * 60` can arm a candidate (default seven minutes).
- Sensitive mode retains the existing weaker slope thresholds. Display units never change these Celsius decisions.
- Require at least one second after the slope candidate is armed and a total fall of 2°C (Standard) or 1°C (Sensitive) from its onset. Recovery by more than 0.5°C from the lowest observed candidate temperature cancels it. This confirmation is an application-specific noise guard, not a verbatim Artisan rule.
- A rapid step of at least 8°C can also confirm after one second without recovery. It must be an adjacent-sample slope break stronger than the preceding rate, not an accumulated fall from an arbitrary high point. This applies to both Charge and Drop, including events that pass below the onset temperature floor during confirmation.
- No cap on the previous-slope comparison: a steep steady fall must not masquerade as a new bend.
- Event time/temperature remain those of the original bend. Confirmation delay does not move the recorded event forward. Sensor-time lag is converted to the current response's reception wall clock; transport latency is not removed.
- After Drop, auto Charge waits for two raw readings rebounding at least 2°C (Standard) or 1°C (Sensitive) from the post-Drop minimum. Manual Charge covers machines without this rebound.

## TP / Yellow

Artisan `checkTPalarmtime` compares later temperatures with the first temperature in its recent window; it does not require each reading to exceed its immediate predecessor.

- Earliest TP confirmation is 20 seconds after Charge. Compare a continuous three-second window against its first temperature, allowing 0.3°C noise and requiring net rise. Require a 0.5°C rebound from the valley for this short confirmation; a six-second rising window can confirm gentler valleys without waiting for a fixed degree gain.
- Select the post-Charge global raw minimum, ignoring isolated dips more than 1°C below both adjacent valid readings. Preserve the existing Artisan-derived 50–150°C sanity range and the original raw valley time/temperature.
- The first real TP stays fixed. A 120-second fallback is provisional, uses the latest fresh valid raw sample's own time/temperature, and can be replaced by a later real TP. It opens Yellow marking, but never opens Replay's BT-trigger gate.
- Yellow requires a rising raw crossing followed by one continuous second at/above `yellowTempC`, after real or fallback TP. Record the original crossing sample. A dip below the threshold or invalid observation clears the crossing. FC remains manual.

## Settings and validation

`autoChargeMode`/`autoDropMode` select Standard or Sensitive. `autoDropStartMin` supports positive fractional minutes (UI 1–30); invalid persisted values retain the previous valid value, or seven minutes. Legacy degree-confirm settings remain ignored; there are no new persisted settings.

References: [Artisan canvas.py](https://github.com/artisan-roaster-scope/artisan/blob/master/src/artisanlib/canvas.py) (`checkTPalarmtime`, sampling/event gates), [Artisan main.py](https://github.com/artisan-roaster-scope/artisan/blob/master/src/artisanlib/main.py) (`checkTop`, `BTbreak`), [Artisan curves](https://artisan-scope.org/docs/curves/) (raw input filtering versus display smoothing).

Regression checks cover 500ms/1s polling, slow and abrupt onsets, integer probes, jitter, small recoverable dips, steep steady cooling, repeated raw noise around TP, temporary rebounds, isolated troughs, Yellow overshoots, missing/repeated observations, freshness/connection gates and manual-event latches. They establish synthetic behavior, not field accuracy: validate thresholds against actual raw recordings, batch weights and manual event marks for each roaster.
