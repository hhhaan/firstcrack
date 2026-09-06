import { EVENT_MARKER_COLORS } from '@features/active-roast/lib/chart-config';
import { PHASE_COLORS, SENSOR_COLORS } from '@features/active-roast/lib/colors';
import { getFcDualStage } from '@features/active-roast/lib/fc-dual-mark';
import type { RoastAlertKind } from '@features/active-roast/lib/roastAlerts';
import { formatTemp } from '@features/active-roast/lib/temperature';
import type { TemperatureUnit } from '@features/active-roast/model/settings';
import { RoastLog } from '@features/active-roast/ui/RoastLog';
import type { LogEntry } from '@shared/types/roast';
import { Play, Square } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { calcEtBtGap, type RoastLogDisplayEntry, type TargetDeltaResult } from '../lib/display-derivatives';
import { EventButtons } from './EventButtons';
import { RoastAlertBanner } from './RoastAlertBanner';

const TARGET_DELTA_COLORS: Record<TargetDeltaResult['status'], string> = {
    within: PHASE_COLORS.ready,
    over: PHASE_COLORS.danger,
    under: SENSOR_COLORS.et,
};

interface RoastSidePanelProps {
    rawBT: number | null;
    rawET: number | null;
    displayRoR: string;
    timeStr: string;
    unit: TemperatureUnit;
    /** machine lifecycle phase (preheating/standby/roasting/ended) — control buttons */
    phase: string;
    /** roast chemistry phase display name (Drying/Maillard/Development/…) */
    roastPhaseName: string;
    roastPhaseColor: string;
    charged: boolean;
    roastEnded: boolean;
    deltaBT: string | null;
    deltaET: string | null;
    targetDelta: TargetDeltaResult | null;
    activeAlerts: RoastAlertKind[];
    dtrPct: number | null;
    devTimeStr: string;
    rollingDtrPct: number | null;
    rollingDevTimeStr: string;
    fcDualMarkEnabled: boolean;
    logEntries: LogEntry[];
    pressedButtons: Set<string>;
    roastLogDisplayEntries: RoastLogDisplayEntry[];
    noteInput: string;
    onNoteChange: (value: string) => void;
    onNoteSubmit: () => void;
    onMarkEvent: (event: string, note: string, pressKey?: string) => void;
    onCycleFc: () => void;
    onHandleDrop: () => void;
    onRemoveLogEntry: (id: string) => void;
    onEnterStandby: () => void;
    onManualCharge: () => void;
    onEndRoast: () => void;
}

export const RoastSidePanel = ({
    rawBT,
    rawET,
    displayRoR,
    timeStr,
    unit,
    phase,
    roastPhaseName,
    roastPhaseColor,
    charged,
    roastEnded,
    deltaBT,
    deltaET,
    targetDelta,
    activeAlerts,
    dtrPct,
    devTimeStr,
    rollingDtrPct,
    rollingDevTimeStr,
    fcDualMarkEnabled,
    logEntries,
    pressedButtons,
    roastLogDisplayEntries,
    noteInput,
    onNoteChange,
    onNoteSubmit,
    onMarkEvent,
    onCycleFc,
    onHandleDrop,
    onRemoveLogEntry,
    onEnterStandby,
    onManualCharge,
    onEndRoast,
}: RoastSidePanelProps) => {
    const { t } = useTranslation();
    const showRollingDtr = rollingDtrPct != null;
    const dtrLabel = showRollingDtr ? 'DTR · Start' : 'DTR';
    const fcDualStage = fcDualMarkEnabled ? getFcDualStage(logEntries) : undefined;
    const etBtGap = calcEtBtGap(rawET, rawBT, unit);

    return (
        <div className="w-48 flex flex-col gap-2.5 px-3 pb-5 border-l border-border-subtle overflow-y-auto shrink-0 min-h-0 self-stretch [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
            <RoastAlertBanner alerts={activeAlerts} />
            {/* ET */}
            <div className="text-right">
                <div className="text-sm text-muted font-semibold uppercase mb-1">ET</div>
                <div
                    className="font-mono text-3xl font-medium whitespace-nowrap overflow-hidden text-ellipsis leading-tight"
                    style={{ color: SENSOR_COLORS.et }}
                >
                    {formatTemp(rawET, unit)}
                </div>
            </div>
            {/* ΔET */}
            <div className="flex items-center justify-between">
                <span className="text-xs text-muted font-semibold uppercase">ΔET (30s)</span>
                <span className="font-mono text-xl font-medium leading-tight" style={{ color: SENSOR_COLORS.et }}>
                    {deltaET != null ? (
                        <>
                            <span className="mr-1">{Number(deltaET) >= 0 ? '+' : '−'}</span>
                            <span>{Math.abs(Number(deltaET)).toFixed(1)}°</span>
                        </>
                    ) : (
                        '—'
                    )}
                </span>
            </div>
            {/* BT */}
            <div className="text-right border-t border-border-subtle pt-3">
                <div className="text-sm text-muted font-semibold uppercase mb-1">BT</div>
                <div
                    className="font-mono text-3xl font-medium whitespace-nowrap overflow-hidden text-ellipsis leading-tight"
                    style={{ color: SENSOR_COLORS.bt }}
                >
                    {formatTemp(rawBT, unit)}
                </div>
            </div>
            {/* ΔBT */}
            <div className="flex items-center justify-between">
                <span className="text-xs text-muted font-semibold uppercase">ΔBT (30s)</span>
                <span className="font-mono text-xl font-medium leading-tight" style={{ color: SENSOR_COLORS.bt }}>
                    {deltaBT != null ? (
                        <>
                            <span className="mr-1">{Number(deltaBT) >= 0 ? '+' : '−'}</span>
                            <span>{Math.abs(Number(deltaBT)).toFixed(1)}°</span>
                        </>
                    ) : (
                        '—'
                    )}
                </span>
            </div>
            {/* ET−BT */}
            {etBtGap != null && (
                <div className="flex items-center justify-between">
                    <span className="text-xs text-muted font-semibold uppercase">{t('activeRoast.sidebar.etBt')}</span>
                    <span
                        className="font-mono text-xl font-medium leading-tight"
                        style={{ color: 'var(--color-primary)' }}
                    >
                        <span className="mr-1">{Number(etBtGap) >= 0 ? '+' : '−'}</span>
                        <span>{Math.abs(Number(etBtGap)).toFixed(1)}°</span>
                    </span>
                </div>
            )}
            {/* Δ Target — 타겟 곡선 대비 현재 BT */}
            {targetDelta != null && (
                <div className="flex items-center justify-between">
                    <span className="text-xs text-muted font-semibold uppercase">Δ Target</span>
                    <span
                        className="font-mono text-xl font-medium leading-tight"
                        style={{ color: TARGET_DELTA_COLORS[targetDelta.status] }}
                    >
                        <span className="mr-1">{targetDelta.deltaDisplay >= 0 ? '+' : '−'}</span>
                        <span>{Math.abs(targetDelta.deltaDisplay).toFixed(1)}°</span>
                    </span>
                </div>
            )}
            {/* RoR */}
            <div className="text-right border-t border-border-subtle pt-3">
                <div className="text-md text-muted font-semibold mb-1">RoR</div>
                <div
                    className="font-mono text-3xl font-medium whitespace-nowrap overflow-hidden text-ellipsis leading-tight"
                    style={{ color: SENSOR_COLORS.ror }}
                >
                    {displayRoR}
                </div>
            </div>
            {/* Time */}
            <div className="text-right border-t border-border-subtle pt-3">
                <div className="text-sm text-muted font-semibold uppercase mb-1">Time</div>
                <div
                    className="font-mono text-3xl font-medium whitespace-nowrap overflow-hidden text-ellipsis leading-tight"
                    style={{ color: 'var(--color-primary)' }}
                >
                    {timeStr}
                </div>
            </div>
            {/* Phase */}
            <div className="flex items-center justify-between border-t border-border-subtle pt-3">
                <span className="text-xs text-muted font-semibold uppercase">Phase</span>
                <span
                    className="font-mono text-base font-medium leading-tight tracking-tight"
                    style={{ color: roastPhaseColor }}
                >
                    {roastPhaseName}
                </span>
            </div>
            {/* DTR + Dev (Start = canonical; Rolling when dual-mark event present) */}
            <div className="flex items-center justify-between">
                <span className="text-xs text-muted font-semibold uppercase whitespace-nowrap">{dtrLabel}</span>
                <span
                    className="font-mono text-xl font-medium leading-tight"
                    style={{ color: PHASE_COLORS.development }}
                >
                    {dtrPct != null ? `${dtrPct}%` : '—'}
                </span>
            </div>
            <div className="flex items-center justify-between">
                <span className="text-xs text-muted font-semibold uppercase whitespace-nowrap">
                    {showRollingDtr ? 'Dev · Start' : 'Dev'}
                </span>
                <span
                    className="font-mono text-lg font-medium leading-tight"
                    style={{ color: PHASE_COLORS.development }}
                >
                    {devTimeStr ?? '—'}
                </span>
            </div>
            {showRollingDtr && (
                <>
                    <div className="flex items-center justify-between">
                        <span className="text-xs text-muted font-semibold uppercase whitespace-nowrap">
                            DTR · Rolling
                        </span>
                        <span
                            className="font-mono text-xl font-medium leading-tight"
                            style={{ color: 'var(--color-event-fc-rolling)' }}
                        >
                            {rollingDtrPct}%
                        </span>
                    </div>
                    <div className="flex items-center justify-between">
                        <span className="text-xs text-muted font-semibold uppercase whitespace-nowrap">
                            Dev · Rolling
                        </span>
                        <span
                            className="font-mono text-lg font-medium leading-tight"
                            style={{ color: 'var(--color-event-fc-rolling)' }}
                        >
                            {rollingDevTimeStr}
                        </span>
                    </div>
                </>
            )}

            <div className="border-t border-border-subtle" />

            {/* Control Panel */}
            <div className="flex flex-col gap-1.5">
                <div className="flex flex-col gap-1.5">
                    {phase === 'preheating' && (
                        <button
                            data-testid="roast-ready"
                            onClick={onEnterStandby}
                            className="flex items-center justify-center gap-1 py-2 rounded-md border-none text-xs font-semibold cursor-pointer"
                            style={{ background: PHASE_COLORS.readyBg, color: PHASE_COLORS.ready }}
                            type="button"
                        >
                            <Play size={12} />
                            Roast Ready
                        </button>
                    )}
                    {phase === 'standby' && (
                        <button
                            data-testid="roast-charge"
                            onClick={onManualCharge}
                            className="flex items-center justify-center gap-1 py-2 rounded-md border-none text-xs font-semibold cursor-pointer"
                            style={{ background: PHASE_COLORS.readyBg, color: PHASE_COLORS.ready }}
                            type="button"
                        >
                            <Play size={12} />
                            Charge
                        </button>
                    )}
                    <button
                        data-testid="roast-end"
                        onClick={onEndRoast}
                        disabled={roastEnded || !charged}
                        aria-label="End roast"
                        type="button"
                        className={`flex items-center justify-center gap-1 py-2 rounded-md border-none text-xs font-semibold ${
                            roastEnded || !charged
                                ? 'bg-surface dark:bg-surface-elevated text-muted cursor-default'
                                : 'cursor-pointer'
                        }`}
                        style={
                            roastEnded || !charged
                                ? undefined
                                : { background: PHASE_COLORS.dangerBg, color: PHASE_COLORS.danger }
                        }
                    >
                        <Square size={12} />
                        End Roast
                    </button>
                </div>
                <EventButtons
                    variant="sidebar"
                    logEntries={logEntries}
                    pressedButtons={pressedButtons}
                    buttons={[
                        {
                            label: 'Yellow',
                            event: 'Yellow',
                            shortcutKey: '1',
                            pressKey: 'Mark Yellow',
                            onClick: () => onMarkEvent('Yellow', 'Color change visible', 'Mark Yellow'),
                        },
                        {
                            label: 'FC Start',
                            event: 'FC Start',
                            shortcutKey: '2',
                            pressKey: 'Mark FC Start',
                            onClick: fcDualMarkEnabled
                                ? onCycleFc
                                : () => onMarkEvent('FC Start', 'First crack started', 'Mark FC Start'),
                            dualStage: fcDualStage,
                        },
                        {
                            label: 'FC End',
                            event: 'FC End',
                            shortcutKey: '3',
                            pressKey: 'Mark FC End',
                            onClick: () => onMarkEvent('FC End', 'First crack ended', 'Mark FC End'),
                        },
                        {
                            label: 'Mark Drop',
                            event: 'Drop',
                            shortcutKey: 'D',
                            pressKey: 'Mark Drop',
                            onClick: onHandleDrop,
                        },
                    ]}
                />
            </div>

            {/* Add Note */}
            <div className="flex flex-col gap-1.5">
                <textarea
                    value={noteInput}
                    onChange={(e) => onNoteChange(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && noteInput.trim()) {
                            e.preventDefault();
                            onNoteSubmit();
                        }
                    }}
                    placeholder="Add note... (Enter to save)"
                    className="h-16 text-xs px-2 py-1.5 rounded bg-surface dark:bg-surface-elevated text-primary placeholder:text-muted focus:outline-none focus:border-border resize-none"
                />
                <button
                    onClick={onNoteSubmit}
                    disabled={!noteInput.trim()}
                    className="px-2.5 py-1.5 rounded-md border-none text-xs font-semibold bg-surface dark:bg-surface-elevated text-muted hover:text-primary disabled:opacity-40 cursor-pointer"
                    type="button"
                >
                    +
                </button>
            </div>

            <div className="border-t border-border-subtle" />

            <RoastLog
                variant="sidebar"
                entries={roastLogDisplayEntries}
                eventMarkerColor={EVENT_MARKER_COLORS}
                onRemoveEntry={onRemoveLogEntry}
            />
        </div>
    );
};
