import { PHASE_COLORS, SENSOR_COLORS } from '@features/active-roast/lib/colors';
import { effectiveCustomShortcuts } from '@features/active-roast/lib/event-buttons';
import { fcDualButtonLabel, getFcDualStage } from '@features/active-roast/lib/fc-dual-mark';
import { isReviewDeletableEvent, reviewMarkToAdd } from '@features/active-roast/lib/review-record-events';
import type { RoastAlertKind } from '@features/active-roast/lib/roastAlerts';
import { formatTemp } from '@features/active-roast/lib/temperature';
import { type TemperatureUnit, useRoastSettings } from '@features/active-roast/model/settings';
import { useCurveStyles } from '@features/active-roast/model/useCurveStyles';
import { isRoastEventMarkEnabled } from '@features/active-roast/model/useRoastKeyboardShortcuts';
import type { RoastLogEditOptions } from '@features/active-roast/ui/RoastLogEntryEditor';
import { endRoastLabel, markDropLabel, roastEventLabel, roastReadyLabel } from '@shared/i18n/roast-event-label';
import { useShortcutStore } from '@shared/store/keyboard-shortcuts';
import type { LogEntry } from '@shared/types/roast';
import { Play, Square } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { RoastLogDisplayEntry, TargetDeltaResult } from '../lib/display-derivatives';
import { EventButtons } from './EventButtons';
import { RoastAlertBanner } from './RoastAlertBanner';
import { RoastSidePanelLayout } from './RoastSidePanelLayout';

const TARGET_DELTA_COLORS: Record<TargetDeltaResult['status'], string> = {
    within: PHASE_COLORS.ready,
    over: PHASE_COLORS.danger,
    // Target delta "under" stays on the legacy ET accent; live ET readout uses curve styles.
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
    fcDualUnwind?: boolean;
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
    logEditOptions?: RoastLogEditOptions;
    onEnterStandby: () => void;
    onManualCharge: () => void;
    /** The shared return/charge slot ignores repeats for a few seconds. */
    chargeLocked?: boolean;
    /** Saved curve is on screen. The charge slot returns to the wait chart instead of charging. */
    reviewing?: boolean;
    onDismissReview?: () => void;
    reviewSaveError?: string | null;
    onEndRoast: () => void;
    /** Pro BBP cooldown — null when inactive or plan-gated */
    bbpTimer: string | null;
    /** End→Charge wait. First-batch preheat is not this. */
    bbpChargeWait: boolean;
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
    fcDualUnwind = false,
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
    logEditOptions,
    onEnterStandby,
    onManualCharge,
    chargeLocked = false,
    reviewing = false,
    onDismissReview,
    reviewSaveError,
    onEndRoast,
    bbpTimer,
    bbpChargeWait,
}: RoastSidePanelProps) => {
    const { t } = useTranslation();
    const showRollingDtr = rollingDtrPct != null;
    const showStartDev = dtrPct != null || (devTimeStr !== '' && devTimeStr !== '—');
    const dtrLabel = showRollingDtr ? 'DTR · Start' : 'DTR';
    const fcDualStage = fcDualMarkEnabled ? getFcDualStage(logEntries) : undefined;
    const canMark = isRoastEventMarkEnabled(phase);
    const marksEnabled = canMark || reviewing;
    const addReviewMark = (event: string, pressKey: string) => {
        const next = reviewMarkToAdd(logEntries, event, fcDualMarkEnabled);
        if (next) onMarkEvent(next, '', pressKey);
    };
    const chargeWait = bbpChargeWait && !charged && !roastEnded;
    const hideRoastClock = chargeWait || (roastEnded && bbpTimer != null);
    const endDisabled = !charged && !roastEnded;
    const curves = useCurveStyles();
    const eventButtons = useRoastSettings().eventButtons;
    const shortcutBindings = useShortcutStore((state) => state.bindings);
    const customShortcuts = effectiveCustomShortcuts(eventButtons.custom, Object.values(shortcutBindings).flat());
    const customShortcutById = new Map(eventButtons.custom.map((item, index) => [item.id, customShortcuts[index]]));

    return (
        <RoastSidePanelLayout
            roastLogDisplayEntries={roastLogDisplayEntries}
            onRemoveLogEntry={onRemoveLogEntry}
            logEditOptions={logEditOptions}
            deletableEvent={reviewing ? isReviewDeletableEvent : undefined}
        >
            <RoastAlertBanner alerts={activeAlerts} />
            {/* ET */}
            <div className="text-right">
                <div className="text-sm text-muted font-semibold uppercase mb-1">ET</div>
                <div
                    className="font-inconsolata text-3xl font-medium whitespace-nowrap overflow-hidden text-ellipsis leading-tight"
                    style={{ color: curves.et.current.color }}
                >
                    {formatTemp(rawET, unit)}
                </div>
            </div>
            {/* ΔET */}
            <div className="flex items-center justify-between">
                <span className="text-xs text-muted font-semibold uppercase">ΔET (30s)</span>
                <span
                    className="font-inconsolata text-xl font-medium leading-tight"
                    style={{ color: curves.et.current.color }}
                >
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
                    className="font-inconsolata text-3xl font-medium whitespace-nowrap overflow-hidden text-ellipsis leading-tight"
                    style={{ color: curves.bt.current.color }}
                >
                    {formatTemp(rawBT, unit)}
                </div>
            </div>
            {/* ΔBT */}
            <div className="flex items-center justify-between">
                <span className="text-xs text-muted font-semibold uppercase">ΔBT (30s)</span>
                <span
                    className="font-inconsolata text-xl font-medium leading-tight"
                    style={{ color: curves.bt.current.color }}
                >
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
            {/* Δ Target — 타겟 곡선 대비 현재 BT */}
            {targetDelta != null && (
                <div className="flex items-center justify-between">
                    <span className="text-xs text-muted font-semibold uppercase">Δ Target</span>
                    <span
                        className="font-inconsolata text-xl font-medium leading-tight"
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
                    className="font-inconsolata text-3xl font-medium whitespace-nowrap overflow-hidden text-ellipsis leading-tight"
                    style={{ color: curves.ror.current.color }}
                >
                    {displayRoR}
                </div>
            </div>
            {/* Time — hide frozen roast clock while unsaved ended + BBP (#484) */}
            {!hideRoastClock && (
                <div className="text-right border-t border-border-subtle pt-3" data-testid="roast-time">
                    <div className="text-sm text-muted font-semibold uppercase mb-1">Time</div>
                    <div
                        className="font-inconsolata text-3xl font-medium whitespace-nowrap overflow-hidden text-ellipsis leading-tight"
                        style={{ color: 'var(--color-primary)' }}
                    >
                        {timeStr}
                    </div>
                </div>
            )}
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
            {bbpTimer != null && (
                <div className="flex items-center justify-between" data-testid="bbp-timer">
                    <span className="text-xs text-muted font-semibold uppercase">{t('activeRoast.sidebar.bbp')}</span>
                    <span className="font-inconsolata text-xl font-medium leading-tight">{bbpTimer}</span>
                </div>
            )}
            {/* DTR + Dev — hidden until FC Start makes them calculable */}
            {showStartDev && (
                <>
                    <div className="flex items-center justify-between" data-testid="dtr-row">
                        <span className="text-xs text-muted font-semibold uppercase whitespace-nowrap">{dtrLabel}</span>
                        <span
                            className="font-inconsolata text-xl font-medium leading-tight"
                            style={{ color: PHASE_COLORS.development }}
                        >
                            {dtrPct != null ? `${dtrPct}%` : '—'}
                        </span>
                    </div>
                    <div className="flex items-center justify-between" data-testid="dev-row">
                        <span className="text-xs text-muted font-semibold uppercase whitespace-nowrap">
                            {showRollingDtr ? 'Dev · Start' : 'Dev'}
                        </span>
                        <span
                            className="font-inconsolata text-lg font-medium leading-tight"
                            style={{ color: PHASE_COLORS.development }}
                        >
                            {devTimeStr ?? '—'}
                        </span>
                    </div>
                </>
            )}
            {showRollingDtr && (
                <>
                    <div className="flex items-center justify-between">
                        <span className="text-xs text-muted font-semibold uppercase whitespace-nowrap">
                            DTR · Rolling
                        </span>
                        <span
                            className="font-inconsolata text-xl font-medium leading-tight"
                            style={{ color: PHASE_COLORS.development }}
                        >
                            {rollingDtrPct}%
                        </span>
                    </div>
                    <div className="flex items-center justify-between">
                        <span className="text-xs text-muted font-semibold uppercase whitespace-nowrap">
                            Dev · Rolling
                        </span>
                        <span
                            className="font-inconsolata text-lg font-medium leading-tight"
                            style={{ color: PHASE_COLORS.development }}
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
                    {phase === 'preheating' && !chargeWait && (
                        <button
                            data-testid="roast-ready"
                            onClick={onEnterStandby}
                            className="flex items-center justify-center gap-1 py-2 rounded-md border-none text-xs font-semibold cursor-pointer"
                            style={{ background: PHASE_COLORS.readyBg, color: PHASE_COLORS.ready }}
                            type="button"
                        >
                            <Play size={12} />
                            {roastReadyLabel()}
                        </button>
                    )}
                    {(phase === 'standby' || chargeWait) &&
                        (reviewing ? (
                            <button
                                data-testid="return-to-charge-wait"
                                onClick={onDismissReview}
                                disabled={chargeLocked}
                                className={`flex items-center justify-center gap-1 rounded-md border border-border bg-main-bg px-2 py-2 text-xs font-semibold text-primary ${
                                    chargeLocked ? 'cursor-default opacity-60' : 'cursor-pointer'
                                }`}
                                type="button"
                            >
                                {t('activeRoast.review.return')}
                            </button>
                        ) : (
                            <button
                                data-testid="roast-charge"
                                onClick={onManualCharge}
                                disabled={chargeLocked}
                                className={`flex items-center justify-center gap-1 py-2 rounded-md border-none text-xs font-semibold ${
                                    chargeLocked ? 'cursor-default opacity-60' : 'cursor-pointer'
                                }`}
                                style={{ background: PHASE_COLORS.readyBg, color: PHASE_COLORS.ready }}
                                type="button"
                            >
                                <Play size={12} />
                                {roastEventLabel('Charge')}
                            </button>
                        ))}
                    {reviewing && reviewSaveError && (
                        <p role="alert" className="text-xs text-secondary">
                            {reviewSaveError}
                        </p>
                    )}
                    <button
                        data-testid="roast-end"
                        onClick={onEndRoast}
                        disabled={endDisabled}
                        aria-label={endRoastLabel()}
                        type="button"
                        className={`flex items-center justify-center gap-1 py-2 rounded-md border-none text-xs font-semibold ${
                            endDisabled
                                ? 'bg-surface dark:bg-surface-elevated text-muted cursor-default'
                                : 'cursor-pointer'
                        }`}
                        style={
                            endDisabled ? undefined : { background: PHASE_COLORS.dangerBg, color: PHASE_COLORS.danger }
                        }
                    >
                        <Square size={12} />
                        {endRoastLabel()}
                    </button>
                </div>
                <EventButtons
                    variant="sidebar"
                    logEntries={logEntries}
                    pressedButtons={pressedButtons}
                    disabled={!marksEnabled}
                    buttons={[
                        ...(eventButtons.yellow
                            ? [
                                  {
                                      label: roastEventLabel('Yellow'),
                                      event: 'Yellow',
                                      shortcutId: 'yellow' as const,
                                      pressKey: 'Mark Yellow',
                                      onClick: () => {
                                          if (reviewing) {
                                              addReviewMark('Yellow', 'Mark Yellow');
                                              return;
                                          }
                                          if (!canMark) return;
                                          onMarkEvent('Yellow', 'Color change visible', 'Mark Yellow');
                                      },
                                  },
                              ]
                            : []),
                        ...(eventButtons.fcStart
                            ? [
                                  {
                                      label: roastEventLabel(
                                          fcDualStage != null
                                              ? fcDualButtonLabel(fcDualStage, fcDualUnwind)
                                              : 'FC Start',
                                      ),
                                      event: 'FC Start',
                                      shortcutId: 'fcStart' as const,
                                      pressKey: 'Mark FC Start',
                                      onClick: () => {
                                          if (reviewing) {
                                              addReviewMark('FC Start', 'Mark FC Start');
                                              return;
                                          }
                                          if (!canMark) return;
                                          if (fcDualMarkEnabled) onCycleFc();
                                          else onMarkEvent('FC Start', 'First crack started', 'Mark FC Start');
                                      },
                                      dualStage: fcDualStage,
                                  },
                              ]
                            : []),
                        ...(eventButtons.fcEnd
                            ? [
                                  {
                                      label: roastEventLabel('FC End'),
                                      event: 'FC End',
                                      shortcutId: 'fcEnd' as const,
                                      pressKey: 'Mark FC End',
                                      onClick: () => {
                                          if (reviewing) {
                                              addReviewMark('FC End', 'Mark FC End');
                                              return;
                                          }
                                          if (!canMark) return;
                                          onMarkEvent('FC End', 'First crack ended', 'Mark FC End');
                                      },
                                  },
                              ]
                            : []),
                        ...eventButtons.custom
                            .filter((item) => item.enabled)
                            .map((item) => {
                                const shortcut = customShortcutById.get(item.id);
                                return {
                                    label: item.name,
                                    event: item.name,
                                    pressKey: item.id,
                                    ...(shortcut ? { shortcutKeys: [shortcut] } : {}),
                                    onClick: () => {
                                        if (reviewing) {
                                            addReviewMark(item.name, item.id);
                                            return;
                                        }
                                        if (!canMark) return;
                                        onMarkEvent(item.name, '', item.id);
                                    },
                                };
                            }),
                        {
                            label: markDropLabel(),
                            event: 'Drop',
                            shortcutId: 'drop' as const,
                            pressKey: 'Mark Drop',
                            disabled: !canMark,
                            onClick: () => {
                                if (!canMark) return;
                                onHandleDrop();
                            },
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
        </RoastSidePanelLayout>
    );
};
