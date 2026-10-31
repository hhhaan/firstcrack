# Quality section

## Goal

Add a sidebar Quality group. It holds a Measurements view of existing roast QC, and the existing Cupping view.

A measurement is a completed roast session. There is no new table and no new column.

## Fields

The view reads and writes only these `roast_sessions` columns, through the current session update mutations:

| Card | Columns |
|------|---------|
| Primary | `moisture_pct`, `density_g_per_l`, `weight_grams`, `output_weight_grams` |
| Color | `color_whole`, `color_ground` |
| Environment | `ambient_temp_celsius`, `ambient_humidity_pct` |

Header badges show `roast_level` and the inventory bean name (`beans.name`). The title is `batch_name`, then `bean_label`, then `beans.name`, then the formatted `roasted_at`. The timestamp is `roasted_at`.

Absent values render as an em dash. A missing roast level or bean name omits that badge.

## Color distribution

The Measurements page draws one distribution from every completed session, above the table. It does not follow the table page. A session whose `color_whole` does not parse is left out. No parseable readings hide the chart.

The detail draws the same chart from that session only.

Neither chart is stored. `parseRoastColorReadings` supplies the numbers.

Bins are 5 Agtron points wide, from 25 through 95. A reading outside that range falls in the nearest end bin. Bar height is the count in the bin. Color runs from dark at the low end to light at the high end. Empty bins stay visible at a minimum height so the scale does not collapse.

Segments use the existing roast level names:

| Level | Whole-bean Agtron |
|-------|-------------------|
| Dark | under 40 |
| Medium-Dark | 40 up to 50 |
| Medium | 50 up to 60 |
| Medium-Light | 60 up to 70 |
| Light | 70 and above |

The percent is that band's count divided by the number of readings, rounded to the nearest percent. A band with no readings still shows 0%. `color_ground` stays a field and does not feed the chart.

These screenshot fields stay out of scope: bulk density, screen size, sample weight, Agtron variance, roast standard, pressure, altitude, and a histogram stored on the session.

## Navigation

`SIDEBAR_GROUPS` gains a third group, `sidebar.groups.quality`, after Roasting.

- `quality` — Measurements. New `View`. Not plan-gated.
- `cupping` — moved out of the roasting group. `FEATURE.cupping` lock stays. The view id stays `cupping`.

Saved sidebar order already re-buckets ids by group, so an existing order that lists `cupping` under roasting places it in Quality after this change. Hidden cupping stays hidden.

The Quality view is a list and a detail. The detail has a back control to the list, the same pattern as history. There is no app-wide breadcrumb bar.

## Measurements

List completed sessions with `useRoastSessionsPaginated`: page size 10, `sortKey` `date`, descending. No search or filters. Columns: date, bean name, roast level, moisture, density, whole-bean color. Whole-bean color uses `roastColorDisplay`.

Opening a row shows three cards in the table above. Each value uses the existing editor:

- moisture, density, room temp, humidity — the fields now inside `QcMeasurementEditor`
- charge and output weight — `ChargeWeightEditor`, `OutputWeightEditor`
- whole and ground color — `RoastColorEditor`

Charge weight keeps its current stock path (`set_session_charge_weight`). Quality does not write the ledger itself.

History detail keeps these editors. Both screens share one implementation.

`views/quality` must not import `views/history`. Move the shared editors to `features/roast-qc`. Both views import that slice. Save behavior, validation, and tests move with them.

Roast level and bean name stay display-only here. Renaming the batch and editing roast level stay on the history detail.

## Empty and locked states

No completed sessions: the list shows an empty state. Cupping without the feature: the nav item stays visible and locked, as it does today. Measurements stay available.

## Tests

- Sidebar: Quality group contains `quality` and `cupping`. Roasting does not contain `cupping`. A saved order that previously placed `cupping` in roasting normalizes it into Quality.
- List renders moisture, density, and whole-bean color from a session row.
- Detail renders the three cards. Clearing moisture calls the existing session update with `moisture_pct: null`.
- The list chart pools every completed session. Readings `58.4, 59.6` on one session fill one bin and show Medium at 100%. Unparseable color text is left out of the pool.
- History detail still renders the same editors.
- Cupping nav stays locked when `FEATURE.cupping` is off.

## Out of scope

Device import. A measurement entity separate from `roast_sessions`. New QC columns. A stored histogram. Removing the history editors. Changing cupping screens beyond their sidebar group.
