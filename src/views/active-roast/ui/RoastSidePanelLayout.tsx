import { updateRoastSettings, useRoastSettings } from '@features/active-roast/model/settings';
import type { RoastLogEditOptions } from '@features/active-roast/ui/RoastLogEntryEditor';
import type { LogEntry } from '@shared/types/roast';
import { PanelResizeHandle } from '@shared/ui/PanelResizeHandle';
import { Minus, Plus } from 'lucide-react';
import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { type ReferenceRoastLog, RoastLogViewer } from './RoastLogViewer';

const SIDE_PANEL_NARROW_PX = 176;
const SIDE_PANEL_WIDE_PX = 240;

export const RoastSidePanelLayout = ({
    children,
    roastLogDisplayEntries,
    onRemoveLogEntry,
    logEditOptions,
    deletableEvent,
    editableEvent,
    referenceLog,
    machineId,
}: {
    children: ReactNode;
    roastLogDisplayEntries: LogEntry[];
    onRemoveLogEntry: (id: string) => void;
    logEditOptions?: RoastLogEditOptions;
    /** Review keeps key marks. Live roast keeps the default removable set. */
    deletableEvent?: (event: string) => boolean;
    /** Saved-curve review also freezes Drop. Live roast freezes Charge only. */
    editableEvent?: (event: string) => boolean;
    referenceLog?: ReferenceRoastLog;
    machineId?: string | null;
}) => {
    const { t } = useTranslation();
    const { logExpanded } = useRoastSettings();
    const [showReference, setShowReference] = useState(false);
    const logPanelId = useId();
    const sidePanelId = useId();
    const [sidePanelWidth, setSidePanelWidth] = useState(SIDE_PANEL_NARROW_PX);
    const logTriggerRef = useRef<HTMLButtonElement>(null);
    const logCloseRef = useRef<HTMLButtonElement>(null);
    const wasExpandedRef = useRef(logExpanded);
    useEffect(() => {
        if (logExpanded) logCloseRef.current?.focus();
        else if (wasExpandedRef.current) logTriggerRef.current?.focus();
        wasExpandedRef.current = logExpanded;
    }, [logExpanded]);
    return (
        <>
            <div
                id={sidePanelId}
                data-testid="roast-side-panel"
                className="@container/readings relative flex min-h-0 shrink-0 flex-col self-stretch border-l border-border-subtle"
                style={{ width: sidePanelWidth }}
            >
                <PanelResizeHandle
                    label={t('activeRoast.readings.resize')}
                    controls={sidePanelId}
                    width={sidePanelWidth}
                    min={SIDE_PANEL_NARROW_PX}
                    max={SIDE_PANEL_WIDE_PX}
                    stops={[SIDE_PANEL_NARROW_PX, SIDE_PANEL_WIDE_PX]}
                    onWidthChange={(next) => {
                        flushSync(() => setSidePanelWidth(next));
                    }}
                />
                <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-3 pb-5 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
                    {children}
                    {!logExpanded && (
                        <>
                            <div className="border-t border-border-subtle" />
                            <div className="flex shrink-0 items-center justify-between">
                                <span className="text-xs font-semibold uppercase text-muted">
                                    {t('activeRoast.log.title')}
                                </span>
                                <button
                                    ref={logTriggerRef}
                                    type="button"
                                    aria-label={t('activeRoast.log.expand')}
                                    aria-expanded={false}
                                    aria-controls={logPanelId}
                                    onClick={() => updateRoastSettings({ logExpanded: true })}
                                    className="flex size-6 shrink-0 items-center justify-center rounded-md text-secondary hover:text-primary hover:bg-surface cursor-pointer"
                                >
                                    <Plus size={14} />
                                </button>
                            </div>
                            <RoastLogViewer
                                reference={referenceLog}
                                showReference={showReference}
                                onSourceChange={setShowReference}
                                variant="sidebar"
                                showHeading={false}
                                entries={roastLogDisplayEntries}
                                onRemoveEntry={onRemoveLogEntry}
                                editOptions={logEditOptions}
                                deletableEvent={deletableEvent}
                                editableEvent={editableEvent}
                                machineId={machineId}
                            />
                        </>
                    )}
                </div>
            </div>
            {logExpanded && (
                <section
                    id={logPanelId}
                    aria-label={t('activeRoast.log.title')}
                    data-testid="roast-log-panel"
                    className="flex w-40 min-h-0 shrink-0 self-stretch flex-col border-l border-border-subtle bg-roast-bg pl-3 pr-3 pb-5"
                >
                    <div className="flex shrink-0 items-center justify-between py-1">
                        <h3 className="text-xs font-semibold uppercase text-muted">{t('activeRoast.log.title')}</h3>
                        <button
                            ref={logCloseRef}
                            type="button"
                            aria-label={t('activeRoast.log.collapse')}
                            onClick={() => updateRoastSettings({ logExpanded: false })}
                            className="flex size-6 shrink-0 items-center justify-center rounded-md text-secondary hover:text-primary hover:bg-surface cursor-pointer"
                        >
                            <Minus size={14} />
                        </button>
                    </div>
                    <div className="min-h-0 overflow-y-auto">
                        <RoastLogViewer
                            reference={referenceLog}
                            showReference={showReference}
                            onSourceChange={setShowReference}
                            variant="panel"
                            entries={roastLogDisplayEntries}
                            onRemoveEntry={onRemoveLogEntry}
                            editOptions={logEditOptions}
                            deletableEvent={deletableEvent}
                            editableEvent={editableEvent}
                            machineId={machineId}
                        />
                    </div>
                </section>
            )}
        </>
    );
};
