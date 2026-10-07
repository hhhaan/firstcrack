import { RoastLog } from '@features/active-roast/ui/RoastLog';
import type { LogEntry } from '@shared/types/roast';
import { Minus, Plus } from 'lucide-react';
import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

export const RoastSidePanelLayout = ({
    children,
    roastLogDisplayEntries,
    onRemoveLogEntry,
}: {
    children: ReactNode;
    roastLogDisplayEntries: LogEntry[];
    onRemoveLogEntry: (id: string) => void;
}) => {
    const { t } = useTranslation();
    const [logExpanded, setLogExpanded] = useState(false);
    const logPanelId = useId();
    const logTriggerRef = useRef<HTMLButtonElement>(null);
    const logCloseRef = useRef<HTMLButtonElement>(null);
    useEffect(() => {
        if (logExpanded) logCloseRef.current?.focus();
    }, [logExpanded]);
    const closeLog = () => {
        setLogExpanded(false);
        logTriggerRef.current?.focus({ preventScroll: true });
    };
    return (
        <>
            <div
                data-testid="roast-side-panel"
                className="w-44 flex flex-col gap-2.5 px-3 pb-5 border-l border-border-subtle overflow-y-auto shrink-0 min-h-0 self-stretch [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
            >
                <div className="sticky top-0 z-10 flex shrink-0 items-center justify-between bg-roast-bg py-1">
                    <span className="text-xs font-semibold uppercase text-muted">{t('activeRoast.log.title')}</span>
                    <button
                        ref={logTriggerRef}
                        type="button"
                        aria-label={t(logExpanded ? 'activeRoast.log.collapse' : 'activeRoast.log.expand')}
                        aria-expanded={logExpanded}
                        aria-controls={logPanelId}
                        onClick={() => (logExpanded ? closeLog() : setLogExpanded(true))}
                        className="flex size-6 shrink-0 items-center justify-center rounded-md text-secondary hover:text-primary hover:bg-surface cursor-pointer"
                    >
                        {logExpanded ? <Minus size={14} /> : <Plus size={14} />}
                    </button>
                </div>
                {children}
                {!logExpanded && (
                    <>
                        <div className="border-t border-border-subtle" />
                        <RoastLog variant="sidebar" entries={roastLogDisplayEntries} onRemoveEntry={onRemoveLogEntry} />
                    </>
                )}
            </div>
            {logExpanded && (
                <section
                    id={logPanelId}
                    aria-label={t('activeRoast.log.title')}
                    data-testid="roast-log-panel"
                    onKeyDown={(event) => {
                        if (event.key === 'Escape') {
                            event.preventDefault();
                            event.stopPropagation();
                            closeLog();
                        }
                    }}
                    className="absolute inset-y-0 left-0 z-20 flex w-64 min-h-0 shrink-0 flex-col border border-border-subtle bg-roast-bg px-3 pb-5 shadow-lg @min-[1100px]:static @min-[1100px]:border-0 @min-[1100px]:border-l @min-[1100px]:shadow-none"
                >
                    <div className="flex shrink-0 items-center justify-between py-1">
                        <h3 className="text-xs font-semibold uppercase text-muted">{t('activeRoast.log.title')}</h3>
                        <button
                            ref={logCloseRef}
                            type="button"
                            aria-label={t('activeRoast.log.collapse')}
                            onClick={closeLog}
                            className="flex size-6 shrink-0 items-center justify-center rounded-md text-secondary hover:text-primary hover:bg-surface cursor-pointer"
                        >
                            <Minus size={14} />
                        </button>
                    </div>
                    <div className="min-h-0 overflow-y-auto break-words [overflow-wrap:anywhere]">
                        <RoastLog
                            variant="main"
                            entries={[...roastLogDisplayEntries].reverse()}
                            onRemoveEntry={onRemoveLogEntry}
                        />
                    </div>
                </section>
            )}
        </>
    );
};
