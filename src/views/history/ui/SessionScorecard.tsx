import { useRoastProfiles } from '@entities/roast-profile';
import { parseStoredRoastEvents } from '@features/active-roast/lib/serialize-roast-events';
import { formatDuration } from '@shared/lib/format';
import { deltaOrNull, deriveSessionDevMetrics } from '@shared/lib/roast-delta';
import type { RoastSessionWithRelations } from '@shared/types/database.types';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

// ponytail: 허용 밴드 하드코드 — 설정화는 수요 생기면 (Roast Settings로)
const BANDS = { dropTemp: 2, duration: 30, devTime: 15, devPct: 2 } as const;

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
    const { data: profiles = [] } = useRoastProfiles(session.user_id);
    const profile = session.profile_id ? (profiles.find((p) => p.id === session.profile_id) ?? null) : null;
    const dev = useMemo(
        () => deriveSessionDevMetrics(parseStoredRoastEvents(session.events), session.duration_seconds),
        [session.events, session.duration_seconds],
    );

    if (!profile) return null;

    const fmtSec = (v: number) => formatDuration(v);
    const fmtSecDelta = (d: number) => signed(d, formatDuration(Math.abs(Math.round(d))));

    const rows: Row[] = [
        {
            key: 'dropTemp',
            labelKey: 'history.table.dropTemp',
            actual: session.drop_temp_celsius,
            target: profile.drop_temp_celsius,
            band: BANDS.dropTemp,
            format: (v) => `${v}°C`,
            formatDelta: (d) => signed(d, `${Math.abs(d).toFixed(1)}°C`),
        },
        {
            key: 'duration',
            labelKey: 'history.table.duration',
            actual: session.duration_seconds,
            target: profile.duration_sec,
            band: BANDS.duration,
            format: fmtSec,
            formatDelta: fmtSecDelta,
        },
        {
            key: 'devTime',
            labelKey: 'history.scorecard.devTime',
            actual: dev.devTimeSec,
            target: profile.dev_time_sec,
            band: BANDS.devTime,
            format: fmtSec,
            formatDelta: fmtSecDelta,
        },
        {
            key: 'devPct',
            labelKey: 'history.scorecard.devPct',
            actual: dev.devPct,
            target: profile.dev_pct,
            band: BANDS.devPct,
            format: (v) => `${v.toFixed(1)}%`,
            formatDelta: (d) => signed(d, `${Math.abs(d).toFixed(1)}%`),
        },
    ];

    return (
        <div className="mt-4 rounded-lg border border-border-subtle dark:border-[#585d61] p-4">
            <div className="mb-3 text-[11px] font-medium uppercase tracking-[0.5px] text-muted">
                {t('history.scorecard.title', { name: profile.name })}
            </div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-3 md:grid-cols-4">
                {rows.map((row) => {
                    const d = deltaOrNull(row.actual, row.target);
                    const deltaColor =
                        d == null
                            ? 'var(--color-muted)'
                            : Math.abs(d) <= row.band
                              ? 'var(--color-palette-green)'
                              : '#dc2626';
                    return (
                        <div key={row.key}>
                            <div className="mb-1 text-[11px] font-medium uppercase tracking-[0.5px] text-muted">
                                {t(row.labelKey)}
                            </div>
                            <div className="font-mono text-[13px] tracking-[0.14px] text-primary">
                                {row.actual != null ? row.format(row.actual) : '—'}
                                <span className="text-muted">
                                    {' / '}
                                    {row.target != null ? row.format(row.target) : '—'}
                                </span>
                            </div>
                            <div className="font-mono text-xs" style={{ color: deltaColor }}>
                                {d == null ? '—' : row.formatDelta(d)}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};
