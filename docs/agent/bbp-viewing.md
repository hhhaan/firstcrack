# Saved BBP and live target (#454)

BBP belongs to the session whose Charge ends it. History reads that session's
`bbp_tsv_path`, `bbp_seconds`, and `charge_temp_celsius`; it never substitutes a
neighboring session or the roast TSV. Its gray section precedes the roast chart.
Both saved and live BBP retain seconds since the previous End, without stretching
or shifting target samples to match the live duration.

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

Entering/leaving BBP clears chart zoom and cursor state. Charge disables the BBP
query/display and restores the ordinary roast target and Charge-relative 00:00
curve. The existing BBP finalize, local TSV, upload/recovery and machine-control
flows remain responsible for recording and persistence.

## Regression coverage

- `chart-queries.test.tsx`: original sample timestamps, late old-workspace response,
  target changes, missing path, empty file, failed download, disabled/Charge query.
- `BbpHistoryChart.test.tsx`: exact session/path, duration/Charge metadata,
  Fahrenheit conversion, loading/empty/error without a fabricated curve.
- `syncRoastProfile.test.ts`: recovery invalidates only the owning workspace's
  profile joins; existing upload durability and ownership checks remain covered.
- Existing BBP store, sidecar polling, save and recovery suites cover collection,
  Charge finalization, roast 00:00 seeding, and local-file preservation.

## Validation (2026-09-17)

Base: `origin/main` at `0de17cf7`; issue #454 had no comments at implementation start.

- `pnpm verify:all`: passed (existing lint and sidecar warnings). Final frontend
  run: 1,236 tests in 182 files passed. Sidecar: 458 tests passed.
- `pnpm typecheck`, i18n parity and diff whitespace checks: passed.
- `pnpm build`: passed with isolated test Supabase environment values; no deployment.
- React Doctor on all changed/new React files: 90/100, no findings.

Browser verification uses Aside controlled by Codex `gpt-5.6-luna`, high effort,
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

Browser limitation: the ad hoc BBP download fixture remained loading. A subsequent
cache-seeding attempt reset the route/session, so simultaneous measured/target
curves and clearing a target were not visually verified. Their query behavior
is covered by automated tests; physical-machine/end-to-end validation remains open.
