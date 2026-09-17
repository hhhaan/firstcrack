import { type CuppingEventSummary, useCreateCuppingEvent, useDeleteCuppingEvent } from '@entities/cupping';
import { formatDateShort } from '@shared/lib/format';
import { Badge } from '@shared/ui/Badge';
import { ModalShell } from '@shared/ui/modal-shell/ModalShell';
import { PageHeader } from '@shared/ui/PageHeader';
import { PageLayout } from '@shared/ui/PageLayout';
import { PillButton } from '@shared/ui/PillButton';
import { SurfaceButton } from '@shared/ui/SurfaceButton';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CuppingEventListSkeleton } from './CuppingSkeleton';
import { DeleteCuppingEventModal } from './DeleteCuppingEventModal';

type CuppingEventListProps = {
    userId: string;
    events: CuppingEventSummary[];
    isLoading: boolean;
    isError: boolean;
    error: unknown;
    onRetry: () => void;
    onSelect: (eventId: string) => void;
};

export const CuppingEventList = ({
    userId,
    events,
    isLoading,
    isError,
    error,
    onRetry,
    onSelect,
}: CuppingEventListProps) => {
    const { t } = useTranslation();
    const createEvent = useCreateCuppingEvent(userId);
    const deleteEvent = useDeleteCuppingEvent(userId);

    const [showCreate, setShowCreate] = useState(false);
    const [title, setTitle] = useState('');
    const [createError, setCreateError] = useState<string | null>(null);
    const [deleting, setDeleting] = useState<CuppingEventSummary | null>(null);

    const handleCreate = async () => {
        setCreateError(null);
        try {
            const ev = await createEvent.mutateAsync({
                title: title.trim() || t('cupping.defaultTitle'),
            });
            setShowCreate(false);
            setTitle('');
            onSelect(ev.id);
        } catch (e) {
            setCreateError(e instanceof Error ? e.message : 'Failed');
        }
    };

    return (
        <PageLayout>
            <PageHeader
                title={t('cupping.title')}
                subtitle={isLoading ? t('cupping.subtitleLoading') : t('cupping.subtitle', { count: events.length })}
                actions={
                    <PillButton onClick={() => setShowCreate(true)} icon={<Plus size={15} strokeWidth={2.5} />}>
                        {t('cupping.newEvent')}
                    </PillButton>
                }
            />

            {isError ? (
                <div className="rounded-lg border border-border-subtle p-6 text-sm text-red-600 dark:border-[#585d61]">
                    <div className="mb-2">{t('cupping.loadError')}</div>
                    <div className="mb-3 text-xs text-muted">{(error as Error)?.message}</div>
                    <button
                        type="button"
                        onClick={onRetry}
                        className="rounded-full border border-border-subtle px-3 py-1.5 text-xs dark:border-[#585d61]"
                    >
                        {t('cupping.retry')}
                    </button>
                </div>
            ) : isLoading ? (
                <CuppingEventListSkeleton />
            ) : events.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-border-subtle bg-main-bg px-6 py-20 dark:border-[#585d61]">
                    <p className="max-w-md text-center text-[13px] leading-relaxed text-muted tracking-[0.14px]">
                        {t('cupping.empty.title')}
                        <br />
                        {t('cupping.empty.description')}
                    </p>
                    <SurfaceButton
                        onClick={() => setShowCreate(true)}
                        icon={<Plus size={14} strokeWidth={2} />}
                        className="px-4 py-2"
                    >
                        {t('cupping.newEvent')}
                    </SurfaceButton>
                </div>
            ) : (
                <div className="overflow-hidden rounded-xl border border-border-subtle bg-main-bg dark:border-[#585d61]">
                    <table className="w-full border-collapse text-left">
                        <thead>
                            <tr className="border-b border-border-subtle dark:border-[#585d61]">
                                <th className="px-4 py-3 text-[11px] font-medium uppercase tracking-[0.5px] text-muted">
                                    {t('cupping.colTitle')}
                                </th>
                                <th className="px-4 py-3 text-[11px] font-medium uppercase tracking-[0.5px] text-muted">
                                    {t('cupping.colDate')}
                                </th>
                                <th className="px-4 py-3 text-[11px] font-medium uppercase tracking-[0.5px] text-muted">
                                    {t('cupping.colSamples')}
                                </th>
                                <th className="px-4 py-3 text-[11px] font-medium uppercase tracking-[0.5px] text-muted">
                                    {t('cupping.colParticipants')}
                                </th>
                                <th className="px-4 py-3 text-[11px] font-medium uppercase tracking-[0.5px] text-muted">
                                    {t('cupping.colAvg')}
                                </th>
                                <th className="px-4 py-3 text-[11px] font-medium uppercase tracking-[0.5px] text-muted">
                                    {t('cupping.colLink')}
                                </th>
                                <th className="w-12 px-4 py-3" />
                            </tr>
                        </thead>
                        <tbody>
                            {events.map((ev) => (
                                <tr
                                    key={ev.id}
                                    className="cursor-pointer border-b border-border-subtle transition hover:bg-surface/50 dark:border-[#585d61]"
                                    onClick={() => onSelect(ev.id)}
                                >
                                    <td className="px-4 py-3 text-[13px] font-medium text-primary">{ev.title}</td>
                                    <td className="px-4 py-3 font-mono text-[13px] text-secondary">
                                        {formatDateShort(ev.held_at)}
                                    </td>
                                    <td className="px-4 py-3 font-mono text-[13px] text-secondary">
                                        {ev.sample_count}
                                    </td>
                                    <td className="px-4 py-3 text-[13px] text-secondary">
                                        {ev.participant_count > 0 ? (
                                            <span
                                                className="font-mono"
                                                title={ev.participants
                                                    .map((n) => n || t('cupping.anonymous'))
                                                    .join(', ')}
                                            >
                                                {ev.participant_count}
                                            </span>
                                        ) : (
                                            <span className="text-muted">—</span>
                                        )}
                                    </td>
                                    <td className="px-4 py-3 font-mono text-[13px] text-secondary">
                                        {ev.avg_score != null ? ev.avg_score.toFixed(2) : '—'}
                                    </td>
                                    <td className="px-4 py-3">
                                        <Badge
                                            tone={ev.ended_at ? 'muted' : ev.active_invite ? 'good' : 'muted'}
                                            size="sm"
                                        >
                                            {ev.ended_at ? 'Ended' : ev.active_invite ? 'Active' : 'No link yet'}
                                        </Badge>
                                    </td>
                                    <td className="px-4 py-3">
                                        <div className="flex justify-end">
                                            <button
                                                type="button"
                                                className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-full text-muted hover:bg-red-50 hover:text-red-600"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    deleteEvent.reset();
                                                    setDeleting(ev);
                                                }}
                                                aria-label={t('cupping.deleteEvent')}
                                            >
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {showCreate ? (
                <ModalShell onClose={() => setShowCreate(false)} labelledBy="cupping-create-title">
                    <div className="w-full max-w-md rounded-xl bg-main-bg p-6 shadow-lg dark:border dark:border-[#585d61]">
                        <h2 id="cupping-create-title" className="mb-4 text-base font-semibold text-primary">
                            {t('cupping.newEvent')}
                        </h2>
                        <label className="mb-4 flex flex-col gap-1 text-[12px] text-muted">
                            {t('cupping.eventTitle')}
                            <input
                                value={title}
                                onChange={(e) => setTitle(e.target.value)}
                                placeholder={t('cupping.defaultTitle')}
                                className="rounded-md border border-border-subtle bg-main-bg px-3 py-2 text-[13px] text-primary dark:border-[#585d61]"
                            />
                        </label>
                        {createError ? <div className="mb-3 text-xs text-red-600">{createError}</div> : null}
                        <div className="flex justify-end gap-2">
                            <button
                                type="button"
                                onClick={() => setShowCreate(false)}
                                className="rounded-full border border-border-subtle px-4 py-2 text-xs dark:border-[#585d61]"
                            >
                                {t('cupping.cancel')}
                            </button>
                            <button
                                type="button"
                                disabled={createEvent.isPending}
                                onClick={() => void handleCreate()}
                                className="rounded-full bg-primary px-4 py-2 text-xs font-medium text-white disabled:opacity-50"
                            >
                                {createEvent.isPending ? t('cupping.creating') : t('cupping.create')}
                            </button>
                        </div>
                    </div>
                </ModalShell>
            ) : null}

            <DeleteCuppingEventModal
                open={deleting != null}
                sessionTitle={deleting?.title ?? ''}
                isLoading={deleteEvent.isPending}
                error={deleteEvent.error ? t('cupping.deleteEventFailed') : null}
                onClose={() => {
                    setDeleting(null);
                    deleteEvent.reset();
                }}
                onConfirm={() => {
                    if (!deleting) return;
                    deleteEvent.mutate(deleting.id, {
                        onSuccess: () => setDeleting(null),
                    });
                }}
            />
        </PageLayout>
    );
};
