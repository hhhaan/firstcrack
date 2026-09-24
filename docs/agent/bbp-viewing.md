# Saved BBP and live target (#454)

BBP belongs to the session whose Charge ends it. History reads that session's
`bbp_tsv_path`, `bbp_seconds`, and `charge_temp_celsius`; it never substitutes a
neighboring session or the roast TSV. BBP and roast share one temperature/control
chart: Charge is 00:00, BBP precedes it at negative times, and only that interval
has a gray background. There is no separate BBP chart.

Stored BBP keeps seconds since the previous End. History display subtracts each
source's own BBP duration without stretching samples. The live target clips saved
samples to the latest 20 minutes and anchors their actual kept span at Charge.
The roast's 00:00 sample owns the
Charge boundary, and RoR stays absent during BBP. Live waiting BBP aligns Charge
at 00:00: target BBP (dashed) plus current temperature sit before Charge, the
roast target dashed line continues after, and only that BBP interval is a
translucent band so the grid stays visible. The 20-minute FIFO cap is not a
reserved axis width (#547): no saved and no measured BBP means no BBP region,
and a shorter recording — including samples that fill only part of the cap
window — is drawn at that length on both the temperature and control grids. After Charge the live chart drops
BBP (no negative lookback) and starts at 00:00; History keeps the combined overlay.

The existing Target selector chooses a roast profile. Its `source_session_id`
links the actual BBP through the source-session join. Profiles without saved BBP
show an empty state; synthetic roast curves are never used as BBP targets. The
existing selection persistence is unchanged: outside a charged roast the header
saves the default profile after its debounce; during a charged/ended roast a
change applies to the current view. BBP has no separate persisted selection.

BBP queries are keyed by workspace owner, source session and file path. Changing
or clearing the target cannot display a late response from the previous key.
Loading, absent/empty data and download errors have different messages; errors
stay local to the curve UI. Upload recovery invalidates the owner's profile
joins so a newly confirmed BBP path can be read without reloading the app.

Entering/leaving live BBP, and Charge, clear chart zoom and cursor state. Live
display does not keep finalized BBP samples after Charge (#433). History still
joins saved BBP at negative time. The existing BBP finalize, local TSV,
upload/recovery and machine-control flows remain responsible for recording and
persistence. Replay and PID still consume the ordinary roast reference only.

## Regression coverage

- `chart-queries.test.tsx`: original sample timestamps, late old-workspace response,
  target changes, missing path, empty file, failed download, disabled/Charge query.
- `HistorySessionChart.test.tsx`: one combined chart, exact session/path,
  Charge-relative alignment, Fahrenheit, controls, and roast availability while
  BBP is absent/loading/failed (and BBP availability if roast loading fails).
- `live-chart-view.test.ts`: live chart is 00:00 roast-only after Charge; before Charge it shows target BBP plus current temperature.
- `roast-curve.test.ts` and chart-option tests: each source's own duration,
  unchanged stored timestamps, Charge sample ownership and gray bands on both
  grids, including zoom clipping.
- `syncRoastProfile.test.ts`: recovery invalidates only the owning workspace's
  profile joins; existing upload durability and ownership checks remain covered.
- Existing BBP store, sidecar polling, save and recovery suites cover collection,
  Charge finalization, roast 00:00 seeding, and local-file preservation.

## Validation (2026-09-17)

Base: `origin/main` at `0de17cf7`; issue #454 had no comments at implementation start.

- `pnpm verify:all`: passed (existing lint and sidecar warnings). Final frontend
  run for the initial implementation: 1,236 tests in 182 files. Sidecar: 458 tests.
- Unified-chart correction: `pnpm verify:core` passed, 1,240 tests in 183 files;
  `pnpm lint` passed with existing warnings.
- `pnpm typecheck`, i18n parity and diff whitespace checks: passed.
- `pnpm build`: passed with isolated test Supabase environment values; no deployment.
- React Doctor initially 90/100. Unified-chart correction: 88/100, one advisory
  about chained array iterations in the display-only BBP alignment helper;
  bounded sample counts and linear work do not justify another abstraction.

Initial browser verification uses Aside controlled by Codex `gpt-5.6-luna`, high effort,
against the real Vite entry at port 1454. Supabase responses/cache and hardware
state are fixtures, not production data or physical-machine validation. Aside
lacks `page.route`/`addInitScript`, so setup uses in-page fetch/cache seeding and
Tauri dialog stubs. Existing save/recovery behavior is covered by automated tests.

Known adjacent limitation: #484 remains open. Dismissing the summary while ended
can leave next-Charge/save re-entry unavailable. This task does not claim to fix it.


Observed UI checks: History expansion displayed the gray saved BBP chart with
1:32 duration and 195 °C Charge temperature. With corrected virtual connection
and Pro-plan fixtures, actual End → confirm → Don’t Save started the BBP timer;
Roast Ready → Charge removed the BBP banner and restored the ordinary target
and a 00:00 Charge log. These are UI interactions against mocked services.

Initial browser limitation: the ad hoc BBP download fixture remained loading. A subsequent
cache-seeding attempt reset the route/session, so simultaneous measured/target
curves and clearing a target were not visually verified. Their query behavior
is covered by automated tests; physical-machine/end-to-end validation remains open.

Unified-chart UI verification: Aside controlled by `gpt-5.6-luna` high effort
opened the real development server at localhost:1420 and expanded History.
Existing records did not expose saved BBP in the checked view. An isolated local
preview then mounted the real `HistorySessionChart` with sample data in its own
QueryClient. Actual button clicks verified BBP inclusion/removal/restoration.
The final screenshot shows gray BBP from -4:00 to Charge 00:00, white roast from
00:00 onward, BT/ET plus target, and matching gray control-chart interval.
The temporary preview is a local build artifact, not a production route or data
write. `pnpm build` also passed with the existing development environment.

Local-main integration preserved the existing BBP Charge-wait behavior while
retaining the finalized sample subscriptions. `pnpm verify:core` passed with
1,253 tests in 185 files; `pnpm lint` passed with existing warnings. An existing
main test required formatting only for the Biome gate.
