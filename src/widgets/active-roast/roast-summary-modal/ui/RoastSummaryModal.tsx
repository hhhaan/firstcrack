import { ModalShell } from '@shared/ui/modal-shell/ModalShell';
import { Spinner } from '@shared/ui/Spinner';

export interface RoastLogEntry {
    time: string;
    event: string;
    temp: string;
    note: string;
}

export interface RoastSummaryData {
    totalTime: string;
    development: string;
    finalBt: string;
    logEntries: RoastLogEntry[];
}

interface RoastSummaryModalProps {
    open: boolean;
    summaryData: RoastSummaryData | null;
    roastNotes: string;
    eventMarkerColor: Record<string, string>;
    onRoastNotesChange: (notes: string) => void;
    onClose: () => void;
    onDiscard: () => void;
    onSave: (notes: string) => Promise<void>;
    isSaving?: boolean;
    ambientTemp?: number | null;
    ambientHumidity?: number | null;
}

export const RoastSummaryModal = ({
    open,
    summaryData,
    roastNotes,
    eventMarkerColor,
    onRoastNotesChange,
    onClose,
    onDiscard,
    onSave,
    isSaving = false,
    ambientTemp,
    ambientHumidity,
}: RoastSummaryModalProps) => {
    if (!open || !summaryData) {
        return null;
    }

    return (
        <ModalShell
            onClose={onClose}
            labelledBy="roast-summary-modal-title"
            overlayClassName="z-[10000]"
            contentClassName="max-w-[420px] w-full bg-main-bg rounded p-7 shadow-[rgba(0,0,0,0.22)_0px_24px_64px,rgba(0,0,0,0.06)_0px_0px_0px_1px]"
        >
            <div className="w-11 h-11 rounded-md bg-[rgba(220,252,231,0.9)] text-[#16a34a] flex items-center justify-center mb-4.5">
                <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                >
                    <polyline points="20 6 9 17 4 12" />
                </svg>
            </div>

            <h2
                id="roast-summary-modal-title"
                className="text-[28px] font-normal leading-[1.05] text-primary tracking-[-0.5px] mb-2.5"
            >
                Roast Complete
            </h2>
            <p className="text-sm text-secondary leading-[1.6] mb-5">
                Ethiopia Yirgacheffe · Natural · Guji Zone · Profile: Signature Light
            </p>

            <div className="grid grid-cols-3 gap-2 mb-5">
                {[
                    { label: 'Total Time', value: summaryData.totalTime },
                    { label: 'Development', value: summaryData.development },
                    { label: 'Final BT', value: summaryData.finalBt },
                ].map(({ label, value }) => (
                    <div key={label} className="bg-surface rounded px-2.5 py-2.5 ">
                        <div className="text-[10px] text-muted font-semibold uppercase mb-0.5">{label}</div>
                        <div className="font-(--font-mono) text-sm text-primary">{value}</div>
                    </div>
                ))}
            </div>

            {ambientTemp != null && ambientHumidity != null && (
                <div className="grid grid-cols-2 gap-2 mb-4">
                    <div className="bg-surface rounded px-2.5 py-2.5 ">
                        <div className="text-[10px] text-muted font-semibold uppercase mb-0.5">Temperature</div>
                        <div className="font-(--font-mono) text-sm text-primary">{ambientTemp}°C</div>
                    </div>
                    <div className="bg-surface rounded px-2.5 py-2.5 ">
                        <div className="text-[10px] text-muted font-semibold uppercase mb-0.5">Humidity</div>
                        <div className="font-(--font-mono) text-sm text-primary">{ambientHumidity}%</div>
                    </div>
                </div>
            )}

            <div className="mb-5">
                <div className="text-[11px] font-semibold text-muted uppercase tracking-[0.4px] mb-2.5">Log</div>
                <div className="flex flex-wrap gap-y-1.5">
                    {summaryData.logEntries
                        .filter(
                            (entry) =>
                                eventMarkerColor[entry.event] ||
                                entry.event === 'Charge' ||
                                entry.event === 'Turning Point',
                        )
                        .map((entry, index, entries) => (
                            <div key={`${entry.time}-${entry.event}-${index}`} className="flex items-center gap-1">
                                <span className="text-xs font-(--font-mono) text-muted">{entry.time}</span>
                                <span
                                    className="text-xs font-medium"
                                    style={{ color: eventMarkerColor[entry.event] ?? 'var(--color-secondary)' }}
                                >
                                    {entry.event}
                                </span>
                                {index < entries.length - 1 && <span className="mx-1.5 text-border text-sm">·</span>}
                            </div>
                        ))}
                </div>
            </div>

            <div className="mb-6">
                <div className="text-[11px] font-semibold text-muted uppercase tracking-[0.4px] mb-2">Notes</div>
                <textarea
                    value={roastNotes}
                    onChange={(event) => onRoastNotesChange(event.target.value)}
                    placeholder="Flavor notes, observations, adjustments for next time..."
                    rows={3}
                    className="w-full px-3.5 py-2.5 rounded border-none bg-surface text-primary text-[13px] font-(--font-body) resize-none  outline-none box-border"
                />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <button
                    onClick={() => onSave(roastNotes)}
                    disabled={isSaving}
                    className="w-full py-3 rounded-lg border-none bg-[rgba(220,252,231,0.9)] text-[#16a34a] text-sm font-medium tracking-[0.14px] flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                >
                    {isSaving && <Spinner />}
                    저장
                </button>
                <button
                    onClick={onDiscard}
                    className="w-full py-3 rounded-lg border-none bg-surface text-secondary text-sm font-medium cursor-pointer tracking-[0.14px] "
                >
                    저장 안 함
                </button>
            </div>
        </ModalShell>
    );
};
