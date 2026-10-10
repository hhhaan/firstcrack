import { updateRoastSettings, useRoastSettings } from '@features/active-roast/model/settings';
import { RoastLog } from '@features/active-roast/ui/RoastLog';
import type { RoastLogEditOptions } from '@features/active-roast/ui/RoastLogEntryEditor';
import type { LogEntry } from '@shared/types/roast';
import { ResizableColumn } from '@shared/ui/ResizableColumn';
import { Minus, Plus } from 'lucide-react';
import { type ReactNode, useEffect, useId, useRef } from 'react';
import { useTranslation } from 'react-i18next';

export const RoastSidePanelLayout = ({
    children,
    roastLogDisplayEntries,
    onRemoveLogEntry,
    logEditOptions,
}: {
    children: ReactNode;
    roastLogDisplayEntries: LogEntry[];
    onRemoveLogEntry: (id: string) => void;
    logEditOptions?: RoastLogEditOptions;
}) => {
    const { t } = useTranslation();
    const { logExpanded } = useRoastSettings();
    const logPanelId = useId();
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
            <ResizableColumn
                columnId="readings"
                floor={176}
                label={t('activeRoast.aside.resizeReadings')}
                testId="roast-side-panel"
                className="border-l border-border-subtle"
            >
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
                            <RoastLog
                                variant="sidebar"
                                showHeading={false}
                                entries={roastLogDisplayEntries}
                                onRemoveEntry={onRemoveLogEntry}
                                editOptions={logEditOptions}
                            />
                        </>
                    )}
                </div>
            </ResizableColumn>
            {logExpanded && (
                <ResizableColumn
                    columnId="log"
                    floor={160}
                    label={t('activeRoast.aside.resizeLog')}
                    panelId={logPanelId}
                    testId="roast-log-panel"
                    ariaLabel={t('activeRoast.log.title')}
                    onBelowFloor={() => updateRoastSettings({ logExpanded: false })}
                    className="border-l border-border-subtle bg-roast-bg"
                >
                    <div className="flex min-h-0 flex-1 flex-col pl-3 pr-0 pb-5">
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
                        <div className="min-h-0 overflow-y-auto break-words [overflow-wrap:anywhere]">
                            <RoastLog
                                variant="panel"
                                entries={[...roastLogDisplayEntries].reverse()}
                                onRemoveEntry={onRemoveLogEntry}
                                editOptions={logEditOptions}
                            />
                        </div>
                    </div>
                </ResizableColumn>
            )}
        </>
    );
};
