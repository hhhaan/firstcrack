import { summarizeSessionEvents, useRoastProfiles } from '@entities/roast-profile';
import { formatTemp, tempUnitLabel, toDisplayTempDelta, useRoastSettings } from '@features/active-roast';
import { parseStoredRoastEvents } from '@features/active-roast/lib/serialize-roast-events';
import { formatDuration } from '@shared/lib/format';
import { deltaOrNull, sessionRoastMetrics } from '@shared/lib/roast-delta';
import type { RoastSessionWithRelations } from '@shared/types/database.types';
import { useTranslation } from 'react-i18next';

// ponytail: 허용 밴드 하드코드 — 설정화는 수요 생기면 (Roast Settings로)
const BANDS = { chargeTemp: 2, dropTemp: 2, duration: 30, devTime: 15, devPct: 2 } as const;

const signed = (d: number, body: string): string => `${d >= 0 ? '+' : '−'}${body}`;

type Row = {
    key: string;
    labelKey: string;
    actual: number | null;
    target: number | null;
    band: number;
    format: (v: number) => string;
    formatDelta: (d: number) => string;
};

export const SessionScorecard = ({ session }: { session: RoastSessionWithRelations }) => {
    const { t } = useTranslation();
    const unit = useRoastSettings().temperatureUnit;
    const { data: profiles = [] } = useRoastProfiles(session.user_id);
    const profile = session.profile_id ? (profiles.find((p) => p.id === session.profile_id) ?? null) : null;
    const metrics = sessionRoastMetrics(session);
    const summary = summarizeSessionEvents(parseStoredRoastEvents(session.events), session);

    if (!profile) return null;

    const fmtSec = (v: number) => formatDuration(v);
    const fmtSecDelta = (d: number) => signed(d, formatDuration(Math.abs(Math.round(d))));

    const rows: Row[] = [
        {
            key: 'chargeTemp',
            labelKey: 'history.table.chargeTemp',
            actual: summary.charge_temp_celsius,
            target: profile.charge_temp_celsius,
            band: BANDS.chargeTemp,
            format: (v) => formatTemp(v, unit),
            formatDelta: (d) => signed(d, `${Math.abs(toDisplayTempDelta(d, unit)).toFixed(1)}${tempUnitLabel(unit)}`),
        },
        {
            key: 'dropTemp',
            labelKey: 'history.table.dropTemp',
            actual: session.drop_temp_celsius,
            target: profile.drop_temp_celsius,
            band: BANDS.dropTemp,
            format: (v) => formatTemp(v, unit),
            formatDelta: (d) => signed(d, `${Math.abs(toDisplayTempDelta(d, unit)).toFixed(1)}${tempUnitLabel(unit)}`),
        },
        {
            key: 'duration',
            labelKey: 'history.table.duration',
            actual: metrics.roastDurationSec,
            target: profile.duration_sec,
            band: BANDS.duration,
            format: fmtSec,
            formatDelta: fmtSecDelta,
        },
        {
            key: 'devTime',
            labelKey: 'history.scorecard.devTime',
            actual: metrics.devTimeSec,
            target: profile.dev_time_sec,
            band: BANDS.devTime,
            format: fmtSec,
            formatDelta: fmtSecDelta,
        },
        {
            key: 'devPct',
            labelKey: 'history.scorecard.devPct',
            actual: metrics.dtrPct,
            target: profile.dev_pct,
            band: BANDS.devPct,
            format: (v) => `${v.toFixed(1)}%`,
            formatDelta: (d) => signed(d, `${Math.abs(d).toFixed(1)}%`),
        },
        // Rolling DTR when FC Rolling exists — no profile target
        ...(metrics.rollingDevPct != null
            ? ([
                  {
                      key: 'devTimeRolling',
                      labelKey: 'history.scorecard.devTimeRolling',
                      actual: metrics.rollingDevTimeSec,
                      target: null,
                      band: BANDS.devTime,
                      format: fmtSec,
                      formatDelta: fmtSecDelta,
                  },
                  {
                      key: 'devPctRolling',
                      labelKey: 'history.scorecard.devPctRolling',
                      actual: metrics.rollingDevPct,
                      target: null,
                      band: BANDS.devPct,
                      format: (v: number) => `${v.toFixed(1)}%`,
                      formatDelta: (d: number) => signed(d, `${Math.abs(d).toFixed(1)}%`),
                  },
              ] satisfies Row[])
            : []),
    ];

    return (
        <section className="rounded-xl border border-border-subtle bg-main-bg p-5">
            <h2 className="m-0 mb-5 break-words text-[13px] font-semibold text-primary">
                {t('history.scorecard.title', { name: profile.name })}
            </h2>
            <div className="grid grid-cols-2 gap-x-6 gap-y-5 @min-[640px]:grid-cols-3">
                {rows.map((row) => {
                    const d = deltaOrNull(row.actual, row.target);
                    const deltaCls =
                        d == null
                            ? 'text-muted'
                            : Math.abs(d) <= row.band
                              ? 'bg-palette-green/12 text-palette-green'
                              : 'bg-amber-500/10 text-amber-700 dark:text-amber-300';
                    return (
                        <div key={row.key} className="min-w-0">
                            <div className="mb-2 text-[11px] font-medium text-muted">{t(row.labelKey)}</div>
                            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-2 font-mono text-[16px] text-primary">
                                {row.actual != null ? row.format(row.actual) : '—'}
                                <span className="text-[12px] text-muted">
                                    {' / '}
                                    {row.target != null ? row.format(row.target) : '—'}
                                </span>
                                <span className={`rounded px-1.5 py-0.5 text-[11px] ${deltaCls}`}>
                                    {d == null ? '—' : row.formatDelta(d)}
                                </span>
                            </div>
                        </div>
                    );
                })}
            </div>
        </section>
    );
};
