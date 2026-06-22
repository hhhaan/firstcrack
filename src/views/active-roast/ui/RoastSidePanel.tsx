import { EVENT_MARKER_COLORS } from '@features/active-roast/lib/chart-config';
import { PHASE_COLORS, SENSOR_COLORS } from '@features/active-roast/lib/colors';
import { formatTemp } from '@features/active-roast/lib/temperature';
import type { TemperatureUnit } from '@features/active-roast/model/settings';
import type { LogEntry } from '@shared/types/roast';
import { EventButtons } from './EventButtons';
import { RoastLog } from './RoastLog';
import { Play, Square } from 'lucide-react';
import type { RoastLogDisplayEntry } from '../lib/display-derivatives';

interface RoastSidePanelProps {
    rawBT: number | null;
    rawET: number | null;
    displayRoR: string;
    timeStr: string;
    unit: TemperatureUnit;
    phase: string;
    charged: boolean;
    raostEnded: boolean;
    deltaBT: string | null;
    deltaET: string | null;
    dtrPct: number | null;
    logEntries: LogEntry[];
    pressedButtons: Set<string>;
    roastLogDisplayEntries: RoastLogDisplayEntry[];
    noteInput: string;
    onNoteChange: (value: string) => void;
    onNoteSubmit: () => void;
    onMarkEvent: (event: string, note: string, pressKey?: string) => void;
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
    charged,
    raostEnded,
    deltaBT,
    deltaET,
    dtrPct,
    logEntries,
    pressedButtons,
    roastLogDisplayEntries,
    noteInput,
    onNoteChange,
    onNoteSubmit,
    onMarkEvent,
    onHandleDrop,
    onRemoveLogEntry,
    onEnterStandby,
    onManualCharge,
    onEndRoast,
}: RoastSidePanelProps) => (
    <div className="w-56 flex flex-col gap-3 px-4 pb-5 border-l border-border-subtle overflow-y-auto shrink-0 min-h-0 self-stretch">
        {/* BT */}
        <div className="text-right">
            <div className="text-sm text-muted font-semibold uppercase mb-1">BT</div>
            <div
                className="font-mono text-4xl font-medium whitespace-nowrap overflow-hidden text-ellipsis leading-tight"
                style={{ color: SENSOR_COLORS.bt }}
            >
                {formatTemp(rawBT, unit)}
            </div>
        </div>
        {/* ΔBT */}
        <div className="flex items-center justify-between">
            <span className="text-xs text-muted font-semibold uppercase">ΔBT (30s)</span>
            <span className="font-mono text-2xl font-medium leading-tight" style={{ color: SENSOR_COLORS.bt }}>
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
        {/* ET */}
        <div className="text-right border-t border-border-subtle pt-3">
            <div className="text-sm text-muted font-semibold uppercase mb-1">ET</div>
            <div
                className="font-mono text-4xl font-medium whitespace-nowrap overflow-hidden text-ellipsis leading-tight"
                style={{ color: SENSOR_COLORS.et }}
            >
                {formatTemp(rawET, unit)}
            </div>
        </div>
        {/* ΔET */}
        <div className="flex items-center justify-between">
            <span className="text-xs text-muted font-semibold uppercase">ΔET (30s)</span>
            <span className="font-mono text-2xl font-medium leading-tight" style={{ color: SENSOR_COLORS.et }}>
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
        {/* RoR */}
        <div className="text-right border-t border-border-subtle pt-3">
            <div className="text-md text-muted font-semibold uppercase mb-1">RoR</div>
            <div
                className="font-mono text-4xl font-medium whitespace-nowrap overflow-hidden text-ellipsis leading-tight"
                style={{ color: SENSOR_COLORS.ror }}
            >
                {displayRoR}
            </div>
        </div>
        {/* Time */}
        <div className="text-right border-t border-border-subtle pt-3">
            <div className="text-sm text-muted font-semibold uppercase mb-1">Time</div>
            <div
                className="font-mono text-4xl font-medium whitespace-nowrap overflow-hidden text-ellipsis leading-tight"
                style={{ color: 'var(--color-primary)' }}
            >
                {timeStr}
            </div>
        </div>
        {/* DTR */}
        <div className="flex items-center justify-between border-t border-border-subtle pt-3">
            <span className="text-xs text-muted font-semibold uppercase">DTR</span>
            <span className="font-mono text-2xl font-medium leading-tight" style={{ color: PHASE_COLORS.development }}>
                {dtrPct != null ? `${dtrPct}%` : '—'}
            </span>
        </div>

        <div className="border-t border-border-subtle" />

        {/* Control Panel */}
        <div className="flex flex-col gap-1.5">
            <div className="flex flex-col gap-1.5">
                {phase === 'preheating' && (
                    <button
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
                    onClick={onEndRoast}
                    disabled={raostEnded || !charged}
                    aria-label="End roast"
                    type="button"
                    className={`flex items-center justify-center gap-1 py-2 rounded-md border-none text-xs font-semibold ${
                        raostEnded || !charged
                            ? 'bg-surface dark:bg-surface-elevated text-muted cursor-default'
                            : 'cursor-pointer'
                    }`}
                    style={
                        raostEnded || !charged
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
                        shortcut: '⌘1',
                        pressKey: 'Mark Yellow',
                        onClick: () => onMarkEvent('Yellow', 'Color change visible', 'Mark Yellow'),
                    },
                    {
                        label: 'FC Start',
                        event: 'FC Start',
                        shortcut: '⌘2',
                        pressKey: 'Mark FC Start',
                        onClick: () => onMarkEvent('FC Start', 'First crack started', 'Mark FC Start'),
                    },
                    {
                        label: 'FC End',
                        event: 'FC End',
                        shortcut: '⌘3',
                        pressKey: 'Mark FC End',
                        onClick: () => onMarkEvent('FC End', 'First crack ended', 'Mark FC End'),
                    },
                    {
                        label: 'Mark Drop',
                        event: 'Drop',
                        shortcut: '⌘D',
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
                    if (e.key === 'Enter' && !e.shiftKey && noteInput.trim()) {
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
