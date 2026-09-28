import { recordedTempDegrees, useRoastSettings } from '@features/active-roast';
import { formatDuration } from '@shared/lib/format';
import { deriveRoastMetrics } from '@shared/lib/roast-delta';
import { sessionBeanName } from '@shared/lib/sessionBeanName';
import type { RoastSessionWithRelations } from '@shared/types/database.types';
import type { StoredRoastEvent } from '@shared/types/roast';
import { AlertCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export type CompareSidebarItem = {
    session: RoastSessionWithRelations;
    color: string;
    hasCurve: boolean;
    events: StoredRoastEvent[];
    chargeBt: number | null;
    dropBt: number | null;
    chargeEt: number | null;
    dropEt: number | null;
    visible: boolean;
};

interface CompareSessionSidebarProps {
    items: CompareSidebarItem[];
    onToggle: (id: string) => void;
}

const eventTime = (events: StoredRoastEvent[], type: string): string => {
    const e = events.find((x) => x.type === type);
    return e ? formatDuration(e.time_sec) : '—';
};

export const CompareSessionSidebar = ({ items, onToggle }: CompareSessionSidebarProps) => {
    const { t } = useTranslation();
    const unit = useRoastSettings().temperatureUnit;
    const val = (n: number | null) => (n != null && Number.isFinite(n) ? String(recordedTempDegrees(n, unit)) : '—');

    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="mb-3 px-1 font-mono text-[13px] font-medium tracking-[0.14px] text-muted tabular-nums">
                {t('history.compare.sidebarTitle', { count: items.length })}
            </div>
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-0.5">
                {items.map((item) => {
                    const { session: s, color, hasCurve, events, visible } = item;
                    const name = sessionBeanName(s) ?? s.roast_profiles?.name ?? '—';
                    return (
                        <button
                            key={s.id}
                            type="button"
                            onClick={() => onToggle(s.id)}
                            className={`w-full rounded-lg border px-3 py-2.5 text-left transition ${
                                visible
                                    ? 'border-black/6 bg-surface dark:border-[#585d61] dark:bg-surface-elevated'
                                    : 'border-transparent bg-transparent opacity-45'
                            }`}
                        >
                            <div className="mb-1.5 flex items-center gap-2">
                                <span
                                    className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] border"
                                    style={
                                        visible
                                            ? { backgroundColor: color, borderColor: color }
                                            : { borderColor: color, backgroundColor: 'transparent' }
                                    }
                                >
                                    {visible && (
                                        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" aria-hidden>
                                            <path
                                                d="M5 12.5l4.5 4.5L19 7"
                                                stroke="#fff"
                                                strokeWidth="3"
                                                strokeLinecap="round"
                                                strokeLinejoin="round"
                                            />
                                        </svg>
                                    )}
                                </span>
                                <span className="truncate text-[12px] font-semibold tracking-[0.14px] text-primary">
                                    {name}
                                </span>
                                {!hasCurve && (
                                    <span
                                        title={t('history.compare.noCurveData')}
                                        className="ml-auto flex items-center"
                                    >
                                        <AlertCircle size={11} strokeWidth={2} className="text-amber-500" />
                                    </span>
                                )}
                            </div>

                            <div className="mb-1 grid grid-cols-2 gap-x-3 gap-y-0.5 pl-5.5">
                                <div className="flex items-baseline justify-between gap-1">
                                    <span className="text-[10px] font-medium uppercase tracking-[0.4px] text-muted">
                                        BT
                                    </span>
                                    <span
                                        className="font-mono text-[12px] font-semibold tabular-nums tracking-[-0.2px]"
                                        style={{ color }}
                                    >
                                        {val(item.dropBt)}
                                    </span>
                                </div>
                                <div className="flex items-baseline justify-between gap-1">
                                    <span className="text-[10px] font-medium uppercase tracking-[0.4px] text-muted">
                                        ET
                                    </span>
                                    <span
                                        className="font-mono text-[12px] font-semibold tabular-nums tracking-[-0.2px]"
                                        style={{ color }}
                                    >
                                        {val(item.dropEt)}
                                    </span>
                                </div>
                                <div className="flex items-baseline justify-between gap-1">
                                    <span className="text-[10px] font-medium uppercase tracking-[0.4px] text-muted">
                                        {t('history.compare.charge')}
                                    </span>
                                    <span className="font-mono text-[11px] tabular-nums text-secondary">
                                        {val(item.chargeBt)}
                                    </span>
                                </div>
                                <div className="flex items-baseline justify-between gap-1">
                                    <span className="text-[10px] font-medium uppercase tracking-[0.4px] text-muted">
                                        {t('history.compare.duration')}
                                    </span>
                                    <span className="font-mono text-[11px] tabular-nums text-secondary">
                                        {formatDuration(
                                            deriveRoastMetrics(events, { durationFallback: s.duration_seconds })
                                                .roastDurationSec,
                                        )}
                                    </span>
                                </div>
                            </div>

                            <div
                                className="mt-1.5 space-y-0.5 border-t border-black/5 pt-1.5 pl-5.5 text-[10px] text-muted dark:border-[#585d61]"
                                style={{ color }}
                            >
                                <div className="flex justify-between gap-2 opacity-90">
                                    <span className="text-muted">FC</span>
                                    <span className="font-mono tabular-nums">{eventTime(events, 'FC Start')}</span>
                                </div>
                                <div className="flex justify-between gap-2 opacity-90">
                                    <span className="text-muted">Drop</span>
                                    <span className="font-mono tabular-nums">{eventTime(events, 'Drop')}</span>
                                </div>
                                {s.weight_grams != null && (
                                    <div className="flex justify-between gap-2 opacity-90">
                                        <span className="text-muted">{t('history.compare.weight')}</span>
                                        <span className="font-mono tabular-nums text-secondary">{s.weight_grams}g</span>
                                    </div>
                                )}
                            </div>
                        </button>
                    );
                })}
            </div>
        </div>
    );
};
