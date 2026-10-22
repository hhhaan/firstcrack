import {
    type CompareChannel,
    compareCurveStyle,
    isCompareControlChannel,
} from '@features/active-roast/lib/chart-option/compare-channels';
import { useCurveStyles } from '@features/active-roast/model/useCurveStyles';
import { formatDateShort } from '@shared/lib/format';
import { sessionRoastTitle } from '@shared/lib/sessionRoastTitle';
import { AlertCircle, Check } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { CompareSessionItem } from './CompareSessionTable';

interface CompareSidePanelProps {
    items: CompareSessionItem[];
    channels: CompareChannel[];
    enabledKeys: string[];
    onToggleChannel: (key: string) => void;
    showModulation: boolean;
    onToggleModulation: () => void;
    showStatistics: boolean;
    onToggleStatistics: () => void;
    focusedSessionId: string | null;
    onToggleRoast: (id: string) => void;
    onFocusSession: (id: string | null) => void;
}

const CheckRow = ({ checked, onChange, children }: { checked: boolean; onChange: () => void; children: ReactNode }) => (
    <label className="flex cursor-pointer items-center gap-1.5 py-0.5 text-[12px] text-primary">
        <input type="checkbox" checked={checked} onChange={onChange} className="accent-primary" />
        {children}
    </label>
);

export const CompareSidePanel = ({
    items,
    channels,
    enabledKeys,
    onToggleChannel,
    showModulation,
    onToggleModulation,
    showStatistics,
    onToggleStatistics,
    focusedSessionId,
    onToggleRoast,
    onFocusSession,
}: CompareSidePanelProps) => {
    const { t } = useTranslation();
    const curves = useCurveStyles();
    const enabled = new Set(enabledKeys);
    const visibleCount = items.filter((item) => item.visible).length;
    const graphChannels = channels.filter((channel) => channel.kind !== 'other');
    const controlChannels = channels.filter(isCompareControlChannel);
    const otherChannels = channels.filter((channel) => channel.kind === 'other' && !isCompareControlChannel(channel));

    return (
        <aside className="flex flex-col gap-3 lg:sticky lg:top-0">
            <section className="overflow-hidden rounded-xl border border-border bg-main-bg">
                <h2 className="border-b border-border bg-surface/60 px-2.5 py-1.5 text-[12px] font-semibold text-primary">
                    {t('history.compare.roasts', { count: items.length })}
                </h2>
                <ul>
                    {items.map((item) => {
                        const { session, visible, hasCurve, color } = item;
                        const name = sessionRoastTitle(session) ?? session.roast_profiles?.name ?? '—';
                        const profileName = session.roast_profiles?.name ?? name;
                        const profileBatch =
                            session.profile_batch_number != null ? `#${session.profile_batch_number}` : null;
                        return (
                            <li
                                key={session.id}
                                data-testid="compare-batch-readout"
                                onMouseEnter={() => onFocusSession(visible ? session.id : null)}
                                onMouseLeave={() => onFocusSession(null)}
                                className={`border-b border-border-subtle last:border-b-0 ${
                                    focusedSessionId === session.id ? 'bg-surface-warm' : ''
                                } ${visible ? '' : 'opacity-45'}`}
                                style={{ boxShadow: `inset 3px 0 0 ${color}` }}
                            >
                                <button
                                    type="button"
                                    aria-pressed={visible}
                                    aria-label={`${name}${profileBatch ? ` · ${profileBatch}` : ''} · ${formatDateShort(session.roasted_at)}`}
                                    aria-disabled={visible && visibleCount === 1}
                                    onClick={() => {
                                        onToggleRoast(session.id);
                                        onFocusSession(null);
                                    }}
                                    onFocus={() => onFocusSession(visible ? session.id : null)}
                                    onBlur={() => onFocusSession(null)}
                                    className="flex w-full items-start gap-1.5 px-2.5 py-1.5 text-left focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary"
                                >
                                    <span
                                        aria-hidden="true"
                                        className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border border-primary ${visible ? 'bg-primary text-main-bg' : ''}`}
                                    >
                                        {visible && <Check size={12} strokeWidth={2.5} />}
                                    </span>
                                    <span className="min-w-0 flex-1">
                                        <span className="flex min-w-0 items-baseline gap-1.5">
                                            {profileBatch && (
                                                <span className="shrink-0 font-mono text-[12px] font-semibold tabular-nums text-primary">
                                                    {profileBatch}
                                                </span>
                                            )}
                                            <span className="min-w-0 truncate text-[12px] font-semibold text-primary">
                                                {profileName}
                                            </span>
                                        </span>
                                        {session.machine_name && (
                                            <span className="block truncate text-[11px] text-secondary">
                                                {session.machine_name}
                                            </span>
                                        )}
                                    </span>
                                    {!hasCurve && (
                                        <span title={t('history.compare.noCurveData')}>
                                            <AlertCircle size={13} className="text-secondary" />
                                        </span>
                                    )}
                                </button>
                            </li>
                        );
                    })}
                </ul>
            </section>

            <section className="rounded-xl border border-border bg-main-bg p-2.5">
                <h2 className="mb-1 text-[12px] font-semibold text-primary">{t('history.compare.display')}</h2>
                {graphChannels.length > 0 && (
                    <fieldset className="mb-2 border-0 p-0">
                        <legend className="mb-1 text-[11px] font-medium tracking-[0.2px] text-muted">
                            {t('history.compare.roastGraph')}
                        </legend>
                        <div className="grid grid-cols-1 gap-x-3 min-[360px]:grid-cols-2">
                            {graphChannels.map((channel) => (
                                <CheckRow
                                    key={channel.key}
                                    checked={enabled.has(channel.key)}
                                    onChange={() => onToggleChannel(channel.key)}
                                >
                                    <span
                                        data-testid={
                                            channel.source === 'extra' ? undefined : `compare-channel-${channel.source}`
                                        }
                                        className="inline-flex items-center gap-1.5"
                                    >
                                        <span
                                            aria-hidden="true"
                                            className="h-2 w-2 shrink-0 rounded-full"
                                            style={{ backgroundColor: compareCurveStyle(channel, curves).color }}
                                        />
                                        {channel.label} {channel.unit}
                                    </span>
                                </CheckRow>
                            ))}
                        </div>
                    </fieldset>
                )}
                {controlChannels.length > 0 && (
                    <fieldset className="mb-2 border-0 p-0">
                        <legend className="mb-1 text-[11px] font-medium tracking-[0.2px] text-muted">
                            {t('history.compare.controlChart')}
                        </legend>
                        {controlChannels.map((channel) => (
                            <CheckRow
                                key={channel.key}
                                checked={enabled.has(channel.key)}
                                onChange={() => onToggleChannel(channel.key)}
                            >
                                {channel.label} {channel.unit}
                            </CheckRow>
                        ))}
                    </fieldset>
                )}
                <fieldset className="mb-2 border-0 p-0">
                    <legend className="mb-1 text-[11px] font-medium tracking-[0.2px] text-muted">
                        {t('history.compare.otherGraphs')}
                    </legend>
                    {otherChannels.map((channel) => (
                        <CheckRow
                            key={channel.key}
                            checked={enabled.has(channel.key)}
                            onChange={() => onToggleChannel(channel.key)}
                        >
                            <span className="inline-flex items-center gap-1.5">
                                <span
                                    aria-hidden="true"
                                    className="h-2 w-2 shrink-0 rounded-full"
                                    style={{ backgroundColor: compareCurveStyle(channel, curves).color }}
                                />
                                {channel.label} {channel.unit}
                            </span>
                        </CheckRow>
                    ))}
                    <CheckRow checked={showModulation} onChange={onToggleModulation}>
                        {t('history.compare.modulation')}
                    </CheckRow>
                </fieldset>
                <fieldset className="border-0 p-0">
                    <legend className="mb-1 text-[11px] font-medium tracking-[0.2px] text-muted">
                        {t('history.compare.sections')}
                    </legend>
                    <CheckRow checked={showStatistics} onChange={onToggleStatistics}>
                        {t('history.compare.statistics')}
                    </CheckRow>
                </fieldset>
            </section>
        </aside>
    );
};
