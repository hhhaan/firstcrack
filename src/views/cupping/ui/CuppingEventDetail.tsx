import {
    type CuppingEventSummary,
    type CuppingSampleWithMeta,
    useCuppingEvent,
    useCuppingSamples,
    useDeleteCuppingEvent,
    useEndCuppingEvent,
} from '@entities/cupping';
import { formatDateShort } from '@shared/lib/format';
import { Badge } from '@shared/ui/Badge';
import { PageHeader } from '@shared/ui/PageHeader';
import { PageLayout } from '@shared/ui/PageLayout';
import { SurfaceButton } from '@shared/ui/SurfaceButton';
import { confirm } from '@tauri-apps/plugin-dialog';
import { ChevronLeft, Plus, Users } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CuppingAddSamplesForm } from './CuppingAddSamplesForm';
import { CuppingResultsShare } from './CuppingResultsShare';
import { CuppingSampleSummary } from './CuppingSampleSummary';
import { CuppingSessionInvite } from './CuppingSessionInvite';
import { DeleteCuppingEventModal } from './DeleteCuppingEventModal';

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
    // Detail row backs list summary when navigating back mid-mutation (ended_at SSoT)
    const { data: eventDetail } = useCuppingEvent(eventId);
    const deleteEvent = useDeleteCuppingEvent(userId);
    const endEvent = useEndCuppingEvent(userId);
    const [sampleForm, setSampleForm] = useState<'add' | CuppingSampleWithMeta | null>(null);
    const [confirmDelete, setConfirmDelete] = useState(false);

    const title = event?.title ?? t('cupping.title');
    const participants = event?.participants ?? [];
    const participantCount = event?.participant_count ?? 0;
    const isEnded = !!(event?.ended_at ?? eventDetail?.ended_at);

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
                title={
                    <span className="inline-flex flex-wrap items-center gap-2">
                        {title}
                        {isEnded ? (
                            <Badge tone="muted" size="sm">
                                Ended
                            </Badge>
                        ) : null}
                    </span>
                }
                subtitle={
                    event
                        ? t('cupping.eventSubtitle', {
                              date: formatDateShort(event.held_at),
                              samples: samples.length,
                              scores: event.score_count,
                              participants: participantCount,
                          })
                        : undefined
                }
                actions={
                    <div className="flex w-full flex-wrap items-center justify-end gap-2">
                        {!isEnded ? (
                            <>
                                <SurfaceButton
                                    onClick={() => setSampleForm('add')}
                                    icon={<Plus size={13} strokeWidth={2} />}
                                >
                                    {t('cupping.addSamples')}
                                </SurfaceButton>
                                <button
                                    type="button"
                                    disabled={endEvent.isPending}
                                    onClick={async () => {
                                        if (await confirm(t('cupping.endEventConfirm'))) {
                                            void endEvent.mutateAsync(eventId);
                                        }
                                    }}
                                    className="rounded-full border border-border-subtle px-3 py-2 text-xs text-primary dark:border-[#585d61] cursor-pointer disabled:opacity-50"
                                >
                                    {endEvent.isPending ? t('cupping.endingEvent') : t('cupping.endEvent')}
                                </button>
                            </>
                        ) : null}
                        <button
                            type="button"
                            onClick={() => {
                                deleteEvent.reset();
                                setConfirmDelete(true);
                            }}
                            className="rounded-full border border-border-subtle px-3 py-2 text-xs text-muted dark:border-[#585d61] cursor-pointer"
                        >
                            {t('cupping.deleteEvent')}
                        </button>
                    </div>
                }
            />

            {isEnded ? (
                <>
                    <div className="mb-5 rounded-xl border border-border-subtle bg-surface/60 px-4 py-3 text-[12px] leading-relaxed text-muted dark:border-[#585d61]">
                        {t('cupping.sessionEndedHint')}
                    </div>
                    <CuppingResultsShare eventId={eventId} userId={userId} listEvent={event} />
                </>
            ) : (
                <CuppingSessionInvite
                    eventId={eventId}
                    userId={userId}
                    title={title}
                    sampleCount={samples.length}
                    isEnded={isEnded}
                />
            )}

            <div className="mb-5 rounded-xl border border-border-subtle bg-main-bg p-4 dark:border-[#585d61]">
                <div className="mb-2 flex items-center gap-2">
                    <Users size={14} strokeWidth={1.75} className="text-muted" />
                    <p className="text-[13px] font-semibold tracking-[0.14px] text-primary">
                        {t('cupping.participantsTitle', { count: participantCount })}
                    </p>
                </div>
                {participantCount === 0 ? (
                    <p className="text-[12px] leading-relaxed tracking-[0.14px] text-muted">
                        {t('cupping.participantsEmpty')}
                    </p>
                ) : (
                    <div className="flex flex-wrap gap-1.5">
                        {participants.map((name) => {
                            const label = name || t('cupping.anonymous');
                            return (
                                <span
                                    key={name || '__anonymous__'}
                                    className="rounded-full bg-surface px-2.5 py-1 text-[12px] font-medium tracking-[0.14px] text-secondary dark:bg-[#2a2e31]"
                                >
                                    {label}
                                </span>
                            );
                        })}
                    </div>
                )}
            </div>

            <CuppingSampleSummary
                userId={userId}
                eventId={eventId}
                samples={samples}
                isLoading={isLoading}
                readOnly={isEnded}
                onAddClick={() => setSampleForm('add')}
                onEditClick={(s) => setSampleForm(s)}
            />

            {sampleForm && !isEnded ? (
                <CuppingAddSamplesForm
                    userId={userId}
                    eventId={eventId}
                    sample={sampleForm === 'add' ? undefined : sampleForm}
                    onClose={() => setSampleForm(null)}
                />
            ) : null}

            <DeleteCuppingEventModal
                open={confirmDelete}
                sessionTitle={title}
                isLoading={deleteEvent.isPending}
                error={deleteEvent.error ? t('cupping.deleteEventFailed') : null}
                onClose={() => {
                    setConfirmDelete(false);
                    deleteEvent.reset();
                }}
                onConfirm={() => {
                    deleteEvent.mutate(eventId, {
                        onSuccess: () => {
                            setConfirmDelete(false);
                            onDeleted();
                        },
                    });
                }}
            />
        </PageLayout>
    );
};
