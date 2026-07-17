import { type CuppingEventSummary, useCuppingSamples, useDeleteCuppingEvent } from '@entities/cupping';
import { formatDateShort } from '@shared/lib/format';
import { PageHeader } from '@shared/ui/PageHeader';
import { PageLayout } from '@shared/ui/PageLayout';
import { SurfaceButton } from '@shared/ui/SurfaceButton';
import { ChevronLeft, Plus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CuppingAddSamplesForm } from './CuppingAddSamplesForm';
import { CuppingSampleSummary } from './CuppingSampleSummary';
import { CuppingSessionInvite } from './CuppingSessionInvite';

type CuppingEventDetailProps = {
    eventId: string;
    event: CuppingEventSummary | null;
    userId: string;
    onBack: () => void;
    onDeleted: () => void;
};

export const CuppingEventDetail = ({ eventId, event, userId, onBack, onDeleted }: CuppingEventDetailProps) => {
    const { t } = useTranslation();
    const { data: samples = [], isLoading } = useCuppingSamples(eventId);
    const deleteEvent = useDeleteCuppingEvent(userId);
    const [showAdd, setShowAdd] = useState(false);

    const title = event?.title ?? t('cupping.title');

    return (
        <PageLayout>
            <button
                type="button"
                onClick={onBack}
                className="mb-4 inline-flex items-center gap-1 border-none bg-transparent p-0 text-[13px] font-medium tracking-[0.14px] text-muted cursor-pointer transition-colors hover:text-primary"
            >
                <ChevronLeft size={14} strokeWidth={2} />
                {t('cupping.back')}
            </button>

            <PageHeader
                title={title}
                subtitle={
                    event
                        ? t('cupping.eventSubtitle', {
                              date: formatDateShort(event.held_at),
                              samples: samples.length,
                              scores: event.score_count,
                          })
                        : undefined
                }
                actions={
                    <div className="flex flex-wrap gap-2">
                        <SurfaceButton onClick={() => setShowAdd(true)} icon={<Plus size={13} strokeWidth={2} />}>
                            {t('cupping.addSamples')}
                        </SurfaceButton>
                        <button
                            type="button"
                            onClick={() => {
                                if (window.confirm(t('cupping.deleteEventConfirm'))) {
                                    void deleteEvent.mutateAsync(eventId).then(onDeleted);
                                }
                            }}
                            className="rounded-full border border-border-subtle px-3 py-2 text-xs text-muted dark:border-[#585d61] cursor-pointer"
                        >
                            {t('cupping.deleteEvent')}
                        </button>
                    </div>
                }
            />

            <CuppingSessionInvite eventId={eventId} userId={userId} title={title} sampleCount={samples.length} />

            <CuppingSampleSummary
                userId={userId}
                eventId={eventId}
                samples={samples}
                isLoading={isLoading}
                onAddClick={() => setShowAdd(true)}
            />

            {showAdd ? (
                <CuppingAddSamplesForm userId={userId} eventId={eventId} onClose={() => setShowAdd(false)} />
            ) : null}
        </PageLayout>
    );
};
