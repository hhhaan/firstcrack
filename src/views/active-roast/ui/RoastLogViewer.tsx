import { RoastLog } from '@features/active-roast/ui/RoastLog';
import type { LogEntry } from '@shared/types/roast';
import type { ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';

export type ReferenceRoastLog = { name: string; entries: LogEntry[]; loading: boolean; error: boolean };

export const RoastLogViewer = ({
    reference,
    showReference,
    onSourceChange,
    ...current
}: ComponentProps<typeof RoastLog> & {
    reference?: ReferenceRoastLog;
    showReference: boolean;
    onSourceChange: (reference: boolean) => void;
}) => {
    const { t } = useTranslation();
    const active = showReference && reference != null;
    return (
        <div>
            {reference && (
                <div
                    role="group"
                    aria-label={t('activeRoast.log.source')}
                    className="mb-2 flex rounded-md bg-surface p-0.5"
                >
                    <button
                        type="button"
                        aria-pressed={!active}
                        onClick={() => onSourceChange(false)}
                        className={`flex-1 rounded px-1 py-1 text-[10px] ${!active ? 'bg-main-bg text-primary' : 'text-muted'}`}
                    >
                        {t('activeRoast.log.current')}
                    </button>
                    <button
                        type="button"
                        aria-pressed={active}
                        onClick={() => onSourceChange(true)}
                        className={`flex-1 rounded px-1 py-1 text-[10px] ${active ? 'bg-main-bg text-primary' : 'text-muted'}`}
                    >
                        {t('activeRoast.log.reference')}
                    </button>
                </div>
            )}
            {active ? (
                <>
                    <p className="mb-2 break-words text-[11px] text-secondary">{reference.name}</p>
                    {reference.entries.length > 0 ? (
                        <RoastLog variant={current.variant} entries={reference.entries} showHeading={false} />
                    ) : (
                        <p role="status" className="py-3 text-[11px] text-muted">
                            {t(
                                reference.loading
                                    ? 'activeRoast.log.referenceLoading'
                                    : reference.error
                                      ? 'activeRoast.log.referenceError'
                                      : 'activeRoast.log.referenceEmpty',
                            )}
                        </p>
                    )}
                    <p className="mt-2 text-[10px] text-muted">{t('activeRoast.log.referenceLiveContinues')}</p>
                </>
            ) : (
                <RoastLog {...current} />
            )}
        </div>
    );
};
