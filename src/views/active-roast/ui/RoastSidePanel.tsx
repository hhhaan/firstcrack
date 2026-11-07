import { PHASE_COLORS, SENSOR_COLORS } from '@features/active-roast/lib/colors';
import { effectiveCustomShortcuts } from '@features/active-roast/lib/event-buttons';
import { fcDualButtonLabel, getFcDualStage } from '@features/active-roast/lib/fc-dual-mark';
import {
    isReviewDeletableEvent,
    isReviewEditableEvent,
    reviewMarkToAdd,
} from '@features/active-roast/lib/review-record-events';
import type { RoastAlertKind } from '@features/active-roast/lib/roastAlerts';
import { formatTemp, tempUnitLabel, toDisplayTemp } from '@features/active-roast/lib/temperature';
import { type TemperatureUnit, useRoastSettings } from '@features/active-roast/model/settings';
import { useCurveStyles } from '@features/active-roast/model/useCurveStyles';
import { isRoastEventMarkEnabled } from '@features/active-roast/model/useRoastKeyboardShortcuts';
import { type RoastLogEditOptions, RoastLogEntryEditor } from '@features/active-roast/ui/RoastLogEntryEditor';
import { endRoastLabel, markDropLabel, roastEventLabel, roastReadyLabel } from '@shared/i18n/roast-event-label';
import { formatElapsed } from '@shared/lib/format';
import { useShortcutStore } from '@shared/store/keyboard-shortcuts';
import type { LogEntry } from '@shared/types/roast';
import { Play, Square } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { RoastLogDisplayEntry, TargetDeltaResult } from '../lib/display-derivatives';
import { EventButtons } from './EventButtons';
import { RoastAlertBanner } from './RoastAlertBanner';
import type { ReferenceRoastLog } from './RoastLogViewer';
import { RoastSidePanelLayout } from './RoastSidePanelLayout';

const READING_FIGURE =
    "font-inconsolata font-medium tabular-nums leading-none [font-feature-settings:'kern'_1,'tnum'_1,'lnum'_1,'zero'_0]";

const formatProbe = (celsius: number | null, unit: TemperatureUnit) =>
    celsius == null ? '—' : toDisplayTemp(celsius, unit).toFixed(1);

const formatSigned = (value: number) => (value < 0 ? `−${Math.abs(value).toFixed(1)}` : Math.abs(value).toFixed(1));

const MetricColumn = ({
    metric,
    testId,
    label,
    value,
    detailLabel,
    detail,
    color,
    className = '',
}: {
    metric?: string;
    testId?: string;
    label: string;
    value: string;
    detailLabel?: string;
    detail?: string;
    color: string;
    className?: string;
}) => (
    <div
        data-roast-metric={metric}
        data-testid={testId}
        className={`flex min-w-0 flex-col items-end gap-1 text-right ${className}`}
    >
        <div className="text-[11px] font-medium leading-none text-muted">{label}</div>
        <div className={`${READING_FIGURE} text-[34px]`} style={{ color }}>
            {value}
        </div>
        {detailLabel != null && (
            <>
                <div className="mt-1.5 text-[11px] font-medium leading-none text-muted">{detailLabel}</div>
                <div className={`${READING_FIGURE} text-lg @min-[256px]/readings:text-2xl`} style={{ color }}>
                    {detail}
                </div>
            </>
        )}
    </div>
);

const SummaryCell = ({
    testId,
    label,
    value,
    color,
}: {
    testId?: string;
    label: string;
    value: string;
    color: string;
}) => (
    <div data-testid={testId} className="flex flex-col items-end gap-1 text-right">
        <span className="text-[11px] font-medium leading-none whitespace-nowrap text-muted">{label}</span>
        <span className={`${READING_FIGURE} text-xl @min-[256px]/readings:text-2xl`} style={{ color }}>
            {value}
        </span>
    </div>
);

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
    readFeedback?: ReactNode;
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
    referenceLog?: ReferenceRoastLog;
    /** Machine whose control names and units label the live log. */
    machineId?: string | null;
    noteInput: string;
    onNoteChange: (value: string) => void;
    onNoteSubmit: () => void;
    onMarkEvent: (event: string, note: string, pressKey?: string) => void;
    onAddEvent?: (event: string, timeSec: number, tempC?: number) => void;
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
    readFeedback,
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
    referenceLog,
    machineId,
    noteInput,
    onNoteChange,
    onNoteSubmit,
    onMarkEvent,
    onAddEvent,
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
    const summaryCells: { testId?: string; label: string; value: string; color: string }[] = [];
    if (showStartDev) {
        summaryCells.push(
            {
                testId: 'dtr-row',
                label: dtrLabel,
                value: dtrPct != null ? `${dtrPct}%` : '—',
                color: PHASE_COLORS.development,
            },
            {
                testId: 'dev-row',
                label: showRollingDtr ? 'Dev · Start' : 'Dev',
                value: devTimeStr ?? '—',
                color: PHASE_COLORS.development,
            },
        );
    }
    if (showRollingDtr) {
        summaryCells.push(
            { label: 'DTR · Rolling', value: `${rollingDtrPct}%`, color: PHASE_COLORS.development },
            { label: 'Dev · Rolling', value: rollingDevTimeStr, color: PHASE_COLORS.development },
        );
    }
    if (targetDelta != null) {
        summaryCells.push({
            testId: 'target-delta',
            label: 'Δ Target',
            value: formatSigned(targetDelta.deltaDisplay),
            color: TARGET_DELTA_COLORS[targetDelta.status],
        });
    }
    if (bbpTimer != null) {
        summaryCells.push({
            testId: 'bbp-timer',
            label: t('activeRoast.sidebar.bbp'),
            value: bbpTimer,
            color: 'var(--color-primary)',
        });
    }
    const summarySpread = summaryCells.length >= 3;
    const fcDualStage = fcDualMarkEnabled ? getFcDualStage(logEntries) : undefined;
    const canMark = isRoastEventMarkEnabled(phase);
    const marksEnabled = reviewing ? Boolean(onAddEvent && logEditOptions) : canMark;
    const [eventDraft, setEventDraft] = useState<LogEntry | null>(null);
    const requestMark = (event: string, note: string, pressKey: string) => {
        if (!marksEnabled) return;
        if (!reviewing) {
            if (event === 'FC Start' && fcDualMarkEnabled) onCycleFc();
            else onMarkEvent(event, note, pressKey);
            return;
        }
        const next = reviewMarkToAdd(logEntries, event, fcDualMarkEnabled);
        if (!next) return;
        setEventDraft({
            id: crypto.randomUUID(),
            event: next,
            time: formatElapsed(logEditOptions?.maxTimeSec ?? 0),
            timeSec: logEditOptions?.maxTimeSec ?? 0,
            temp: '',
            tempC: null,
            note: '',
        });
    };
    const chargeWait = bbpChargeWait && !charged && !roastEnded;
    const hideRoastClock = chargeWait || (roastEnded && bbpTimer != null);
    const showRoR = charged;
    const endDisabled = reviewing || (!charged && !roastEnded);
    const curves = useCurveStyles();
    const eventButtons = useRoastSettings().eventButtons;
    const shortcutBindings = useShortcutStore((state) => state.bindings);
    const customShortcuts = effectiveCustomShortcuts(eventButtons.custom, Object.values(shortcutBindings).flat());
    const customShortcutById = new Map(eventButtons.custom.map((item, index) => [item.id, customShortcuts[index]]));

    return (
        <RoastSidePanelLayout
            roastLogDisplayEntries={roastLogDisplayEntries}
            referenceLog={referenceLog}
            machineId={machineId}
            onRemoveLogEntry={onRemoveLogEntry}
            logEditOptions={logEditOptions}
            deletableEvent={reviewing ? isReviewDeletableEvent : undefined}
            editableEvent={reviewing ? isReviewEditableEvent : undefined}
        >
            <RoastAlertBanner alerts={activeAlerts} />
            <div data-testid="roast-readings">
                <div className="flex flex-col @min-[256px]/readings:hidden">
                    <div className="text-right">
                        <div className="mb-1 text-[11px] font-medium text-muted uppercase">ET</div>
                        <div
                            className="font-inconsolata text-[34px] font-medium leading-tight whitespace-nowrap"
                            style={{ color: curves.et.current.color }}
                        >
                            {formatTemp(rawET, unit)}
                        </div>
                    </div>
                    <div className="flex items-center justify-between">
                        <span className="text-[11px] font-medium text-muted uppercase">ΔET (30s)</span>
                        <span
                            className="font-inconsolata text-xl font-medium leading-tight"
                            style={{ color: curves.et.current.color }}
                        >
                            {deltaET != null ? formatSigned(Number(deltaET)) + '°' : '—'}
                        </span>
                    </div>
                    <div className="border-t border-border-subtle pt-3 text-right">
                        <div className="mb-1 text-[11px] font-medium text-muted uppercase">BT</div>
                        <div
                            className="font-inconsolata text-[34px] font-medium leading-tight whitespace-nowrap"
                            style={{ color: curves.bt.current.color }}
                        >
                            {formatTemp(rawBT, unit)}
                        </div>
                    </div>
                    <div className="flex items-center justify-between">
                        <span className="text-[11px] font-medium text-muted uppercase">ΔBT (30s)</span>
                        <span
                            className="font-inconsolata text-xl font-medium leading-tight"
                            style={{ color: curves.bt.current.color }}
                        >
                            {deltaBT != null ? formatSigned(Number(deltaBT)) + '°' : '—'}
                        </span>
                    </div>
                    {showRoR && (
                        <div className="border-t border-border-subtle pt-3 text-right">
                            <div className="mb-1 text-[11px] font-medium text-muted">RoR</div>
                            <div
                                className="font-inconsolata text-[34px] font-medium leading-tight whitespace-nowrap"
                                style={{ color: curves.ror.current.color }}
                            >
                                {displayRoR}
                            </div>
                        </div>
                    )}
                    {!hideRoastClock && (
                        <div className="border-t border-border-subtle pt-3 text-right" data-testid="roast-time">
                            <div className="mb-1 text-[11px] font-medium text-muted uppercase">Time</div>
                            <div className="font-inconsolata text-[34px] font-medium leading-tight whitespace-nowrap text-primary">
                                {timeStr}
                            </div>
                        </div>
                    )}
                </div>
                <div className="hidden grid-cols-2 gap-x-3 gap-y-4 @min-[256px]/readings:grid">
                    <MetricColumn
                        metric="ET"
                        label={`ET (${tempUnitLabel(unit)})`}
                        value={formatProbe(rawET, unit)}
                        detailLabel="ΔET (30s)"
                        detail={deltaET != null ? formatSigned(Number(deltaET)) : '—'}
                        color={curves.et.current.color}
                    />
                    <MetricColumn
                        metric="BT"
                        label="BT"
                        value={formatProbe(rawBT, unit)}
                        detailLabel="ΔBT (30s)"
                        detail={deltaBT != null ? formatSigned(Number(deltaBT)) : '—'}
                        color={curves.bt.current.color}
                    />
                    {showRoR && (
                        <MetricColumn metric="RoR" label="RoR" value={displayRoR} color={curves.ror.current.color} />
                    )}
                    {!hideRoastClock && (
                        <MetricColumn
                            metric="Time"
                            testId="roast-time-wide"
                            label="Time"
                            value={timeStr}
                            color="var(--color-primary)"
                            className="col-start-2"
                        />
                    )}
                </div>
            </div>
            {readFeedback}
            {summaryCells.length > 0 && (
                <div
                    data-testid="roast-summary"
                    className={`flex gap-y-2 border-t border-border-subtle pt-2.5 ${
                        summarySpread
                            ? 'justify-between [&>*]:min-w-0 [&>*]:flex-1'
                            : 'justify-end gap-x-10 [&>*]:shrink-0'
                    }`}
                >
                    {summaryCells.map((cell) => (
                        <SummaryCell key={cell.label} {...cell} />
                    ))}
                </div>
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
                                style={{ background: 'oklch(0.86 0.11 155)', color: 'oklch(0.4 0.16 155)' }}
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
                        className={`flex items-center justify-center gap-1 py-2 rounded-md border-none text-xs font-semibold transition-colors duration-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
                            endDisabled
                                ? 'bg-surface dark:bg-surface-elevated text-muted cursor-default'
                                : 'bg-action text-on-action hover:bg-action/85 active:bg-secondary cursor-pointer'
                        }`}
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
                                      disabled: reviewing && reviewMarkToAdd(logEntries, 'Yellow', false) == null,
                                      onClick: () => requestMark('Yellow', 'Color change visible', 'Mark Yellow'),
                                  },
                              ]
                            : []),
                        ...(eventButtons.fcStart
                            ? [
                                  {
                                      label: roastEventLabel(
                                          fcDualStage != null
                                              ? fcDualButtonLabel(fcDualStage, reviewing ? false : fcDualUnwind)
                                              : 'FC Start',
                                      ),
                                      event: 'FC Start',
                                      shortcutId: 'fcStart' as const,
                                      pressKey: 'Mark FC Start',
                                      disabled:
                                          reviewing &&
                                          reviewMarkToAdd(logEntries, 'FC Start', fcDualMarkEnabled) == null,
                                      onClick: () => requestMark('FC Start', 'First crack started', 'Mark FC Start'),
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
                                      disabled: reviewing && reviewMarkToAdd(logEntries, 'FC End', false) == null,
                                      onClick: () => requestMark('FC End', 'First crack ended', 'Mark FC End'),
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
                                        requestMark(item.name, '', item.id);
                                    },
                                };
                            }),
                        {
                            label: markDropLabel(),
                            event: 'Drop',
                            shortcutId: 'drop' as const,
                            pressKey: 'Mark Drop',
                            disabled: reviewing || !canMark,
                            onClick: () => {
                                if (reviewing || !canMark) return;
                                onHandleDrop();
                            },
                        },
                    ]}
                />
                {reviewing && eventDraft && logEditOptions && onAddEvent && (
                    <div
                        className="mt-2 rounded border border-border-subtle p-2"
                        role="group"
                        aria-label={roastEventLabel(eventDraft.event)}
                    >
                        <p className="m-0 text-xs text-primary">{roastEventLabel(eventDraft.event)}</p>
                        <RoastLogEntryEditor
                            key={eventDraft.id}
                            entry={eventDraft}
                            options={{
                                ...logEditOptions,
                                onEditEntry: (_id, patch) => {
                                    if (patch.timeSec != null) onAddEvent(eventDraft.event, patch.timeSec, patch.tempC);
                                },
                            }}
                            onClose={() => setEventDraft(null)}
                        />
                    </div>
                )}
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
                    className="h-16 resize-none rounded border border-transparent bg-surface px-2 py-1.5 text-xs text-primary outline-none placeholder:text-muted focus-visible:border-secondary dark:bg-surface-elevated"
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
