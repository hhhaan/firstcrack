import {
    type CuppingEventSummary,
    type CuppingSampleWithMeta,
    useAddCuppingSamples,
    useCreateCuppingEvent,
    useCreateSampleInvite,
    useCuppingEvents,
    useCuppingSamples,
    useDeleteCuppingEvent,
    useDeleteCuppingSample,
    useRevokeCuppingInvite,
} from '@entities/cupping';
import { useRoastSessions } from '@entities/roast';
import { formatDateShort } from '@shared/lib/format';
import { useAuthStore } from '@shared/store/auth';
import { ModalShell } from '@shared/ui/modal-shell/ModalShell';
import { PageHeader } from '@shared/ui/PageHeader';
import { PageLayout } from '@shared/ui/PageLayout';
import { Check, ChevronLeft, Copy, Link2, Plus, QrCode, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

export const Cupping = () => {
    const { t } = useTranslation();
    const userId = useAuthStore((s) => s.user?.id ?? '');
    const { data: events = [], isLoading, isError, error, refetch } = useCuppingEvents(userId);
    const createEvent = useCreateCuppingEvent(userId);
    const deleteEvent = useDeleteCuppingEvent(userId);

    const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
    const [showCreate, setShowCreate] = useState(false);
    const [title, setTitle] = useState('');
    const [createError, setCreateError] = useState<string | null>(null);

    const selected = events.find((e) => e.id === selectedEventId) ?? null;

    const handleCreate = async () => {
        setCreateError(null);
        try {
            const ev = await createEvent.mutateAsync({
                title: title.trim() || t('cupping.defaultTitle'),
            });
            setShowCreate(false);
            setTitle('');
            setSelectedEventId(ev.id);
        } catch (e) {
            setCreateError(e instanceof Error ? e.message : 'Failed');
        }
    };

    if (selectedEventId) {
        return (
            <EventDetail
                eventId={selectedEventId}
                event={selected}
                userId={userId}
                onBack={() => setSelectedEventId(null)}
                onDeleted={() => {
                    setSelectedEventId(null);
                    void refetch();
                }}
            />
        );
    }

    return (
        <PageLayout>
            <PageHeader
                title={t('cupping.title')}
                subtitle={isLoading ? t('cupping.subtitleLoading') : t('cupping.subtitle', { count: events.length })}
                actions={
                    <button
                        type="button"
                        onClick={() => setShowCreate(true)}
                        className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-xs font-medium text-white"
                    >
                        <Plus size={14} />
                        {t('cupping.newEvent')}
                    </button>
                }
            />

            {isError ? (
                <div className="rounded-lg border border-border-subtle p-6 text-sm text-red-600 dark:border-[#585d61]">
                    <div className="mb-2">{t('cupping.loadError')}</div>
                    <div className="mb-3 text-xs text-muted">{(error as Error)?.message}</div>
                    <button
                        type="button"
                        onClick={() => void refetch()}
                        className="rounded-full border border-border-subtle px-3 py-1.5 text-xs dark:border-[#585d61]"
                    >
                        {t('cupping.retry')}
                    </button>
                </div>
            ) : isLoading ? (
                <div className="text-sm text-muted">{t('cupping.loading')}</div>
            ) : events.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-4 rounded-xl bg-main-bg px-4 py-20 dark:border dark:border-[#585d61]">
                    <p className="text-center text-[13px] text-muted">
                        {t('cupping.empty.title')}
                        <br />
                        {t('cupping.empty.description')}
                    </p>
                    <button
                        type="button"
                        onClick={() => setShowCreate(true)}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-surface px-4 py-2 text-[13px] font-medium text-primary dark:bg-surface-elevated"
                    >
                        <Plus size={14} />
                        {t('cupping.newEvent')}
                    </button>
                </div>
            ) : (
                <div className="overflow-hidden rounded-lg bg-main-bg dark:border dark:border-[#585d61]">
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
                                    {t('cupping.colAvg')}
                                </th>
                                <th className="w-12 px-4 py-3" />
                            </tr>
                        </thead>
                        <tbody>
                            {events.map((ev) => (
                                <tr
                                    key={ev.id}
                                    className="cursor-pointer border-b border-border-subtle transition hover:bg-surface/50 dark:border-[#585d61]"
                                    onClick={() => setSelectedEventId(ev.id)}
                                >
                                    <td className="px-4 py-3 text-[13px] font-medium text-primary">{ev.title}</td>
                                    <td className="px-4 py-3 font-mono text-[13px] text-secondary">
                                        {formatDateShort(ev.held_at)}
                                    </td>
                                    <td className="px-4 py-3 font-mono text-[13px] text-secondary">
                                        {ev.sample_count}
                                    </td>
                                    <td className="px-4 py-3 font-mono text-[13px] text-secondary">
                                        {ev.avg_score != null ? ev.avg_score.toFixed(2) : '—'}
                                    </td>
                                    <td className="px-4 py-3 text-right">
                                        <button
                                            type="button"
                                            className="inline-flex h-7 w-7 items-center justify-center rounded-full text-muted hover:bg-red-50 hover:text-red-600"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                if (window.confirm(t('cupping.deleteEventConfirm'))) {
                                                    void deleteEvent.mutateAsync(ev.id);
                                                }
                                            }}
                                            aria-label={t('cupping.deleteEvent')}
                                        >
                                            <Trash2 size={14} />
                                        </button>
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
        </PageLayout>
    );
};

function EventDetail({
    eventId,
    event,
    userId,
    onBack,
    onDeleted,
}: {
    eventId: string;
    event: CuppingEventSummary | null;
    userId: string;
    onBack: () => void;
    onDeleted: () => void;
}) {
    const { t } = useTranslation();
    const { data: samples = [], isLoading, refetch } = useCuppingSamples(eventId);
    const { data: roastSessions = [] } = useRoastSessions(userId, 'completed');
    const addSamples = useAddCuppingSamples(userId, eventId);
    const deleteSample = useDeleteCuppingSample(userId, eventId);
    const createInvite = useCreateSampleInvite(userId, eventId);
    const revokeInvite = useRevokeCuppingInvite(eventId);
    const deleteEvent = useDeleteCuppingEvent(userId);

    const [showAdd, setShowAdd] = useState(false);
    const [selectedRoastIds, setSelectedRoastIds] = useState<string[]>([]);
    const [freeLabel, setFreeLabel] = useState('');
    const [qrSample, setQrSample] = useState<CuppingSampleWithMeta | null>(null);
    const [copied, setCopied] = useState(false);
    const [addError, setAddError] = useState<string | null>(null);

    const title = event?.title ?? t('cupping.title');

    useEffect(() => {
        if (!copied) return;
        const id = window.setTimeout(() => setCopied(false), 1500);
        return () => window.clearTimeout(id);
    }, [copied]);

    const roastOptions = useMemo(
        () =>
            roastSessions.map((s) => ({
                id: s.id,
                label: `${s.beans?.name ?? 'Roast'} · ${formatDateShort(s.roasted_at)}`,
            })),
        [roastSessions],
    );

    const toggleRoast = (id: string) => {
        setSelectedRoastIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    };

    const handleAdd = async () => {
        setAddError(null);
        const items: { label: string; roastSessionId?: string | null }[] = [];
        for (const id of selectedRoastIds) {
            const opt = roastOptions.find((o) => o.id === id);
            items.push({ label: opt?.label ?? 'Sample', roastSessionId: id });
        }
        if (freeLabel.trim()) {
            items.push({ label: freeLabel.trim(), roastSessionId: null });
        }
        if (!items.length) {
            setAddError(t('cupping.addSamplesEmpty'));
            return;
        }
        try {
            await addSamples.mutateAsync(items);
            setShowAdd(false);
            setSelectedRoastIds([]);
            setFreeLabel('');
            void refetch();
        } catch (e) {
            setAddError(e instanceof Error ? e.message : 'Failed');
        }
    };

    const handleQr = async (sample: CuppingSampleWithMeta) => {
        if (sample.active_invite) {
            setQrSample(sample);
            return;
        }
        const inv = await createInvite.mutateAsync({
            sampleId: sample.id,
            roastSessionId: sample.roast_session_id,
        });
        setQrSample({
            ...sample,
            active_invite: inv,
        });
        void refetch();
    };

    const activeUrl = qrSample?.active_invite?.url ?? null;
    const qrSrc = activeUrl
        ? `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(activeUrl)}`
        : null;

    return (
        <PageLayout>
            <div className="mb-4 flex items-center gap-2">
                <button
                    type="button"
                    onClick={onBack}
                    className="inline-flex items-center gap-1 rounded-full border border-border-subtle px-3 py-1.5 text-xs text-secondary dark:border-[#585d61]"
                >
                    <ChevronLeft size={14} />
                    {t('cupping.back')}
                </button>
            </div>

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
                        <button
                            type="button"
                            onClick={() => setShowAdd(true)}
                            className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-xs font-medium text-white"
                        >
                            <Plus size={14} />
                            {t('cupping.addSamples')}
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                if (window.confirm(t('cupping.deleteEventConfirm'))) {
                                    void deleteEvent.mutateAsync(eventId).then(onDeleted);
                                }
                            }}
                            className="rounded-full border border-border-subtle px-3 py-2 text-xs text-muted dark:border-[#585d61]"
                        >
                            {t('cupping.deleteEvent')}
                        </button>
                    </div>
                }
            />

            {isLoading ? (
                <div className="text-sm text-muted">{t('cupping.loading')}</div>
            ) : samples.length === 0 ? (
                <div className="rounded-xl bg-main-bg px-4 py-16 text-center text-[13px] text-muted dark:border dark:border-[#585d61]">
                    {t('cupping.noSamples')}
                </div>
            ) : (
                <div className="overflow-x-auto rounded-lg bg-main-bg dark:border dark:border-[#585d61]">
                    <table className="w-full min-w-[640px] border-collapse text-left">
                        <thead>
                            <tr className="border-b border-border-subtle dark:border-[#585d61]">
                                <th className="px-4 py-3 text-[11px] font-medium uppercase tracking-[0.5px] text-muted">
                                    #
                                </th>
                                <th className="px-4 py-3 text-[11px] font-medium uppercase tracking-[0.5px] text-muted">
                                    {t('cupping.colLabel')}
                                </th>
                                <th className="px-4 py-3 text-[11px] font-medium uppercase tracking-[0.5px] text-muted">
                                    {t('cupping.colRoast')}
                                </th>
                                <th className="px-4 py-3 text-[11px] font-medium uppercase tracking-[0.5px] text-muted">
                                    {t('cupping.colScores')}
                                </th>
                                <th className="px-4 py-3 text-[11px] font-medium uppercase tracking-[0.5px] text-muted">
                                    {t('cupping.colAvg')}
                                </th>
                                <th className="px-4 py-3 text-[11px] font-medium uppercase tracking-[0.5px] text-muted">
                                    {t('cupping.colActions')}
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            {samples.map((s, i) => (
                                <tr key={s.id} className="border-b border-border-subtle dark:border-[#585d61]">
                                    <td className="px-4 py-3 font-mono text-[12px] text-muted">{i + 1}</td>
                                    <td className="px-4 py-3 text-[13px] font-medium text-primary">{s.label}</td>
                                    <td className="px-4 py-3 text-[12px] text-secondary">
                                        {s.roast_sessions
                                            ? `${s.roast_sessions.beans?.name ?? '—'} · ${formatDateShort(s.roast_sessions.roasted_at)}`
                                            : t('cupping.noRoastLink')}
                                    </td>
                                    <td className="px-4 py-3 font-mono text-[13px] text-secondary">{s.score_count}</td>
                                    <td className="px-4 py-3 font-mono text-[13px] text-secondary">
                                        {s.avg_score != null ? s.avg_score.toFixed(2) : '—'}
                                    </td>
                                    <td className="px-4 py-3">
                                        <div className="flex flex-wrap gap-1.5">
                                            <button
                                                type="button"
                                                onClick={() => void handleQr(s)}
                                                disabled={createInvite.isPending}
                                                className="inline-flex items-center gap-1 rounded-full border border-border-subtle px-2.5 py-1 text-[11px] text-secondary dark:border-[#585d61]"
                                            >
                                                <QrCode size={12} />
                                                QR
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    if (window.confirm(t('cupping.deleteSampleConfirm'))) {
                                                        void deleteSample.mutateAsync(s.id);
                                                    }
                                                }}
                                                className="inline-flex items-center gap-1 rounded-full border border-border-subtle px-2.5 py-1 text-[11px] text-muted dark:border-[#585d61]"
                                            >
                                                <Trash2 size={12} />
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {showAdd ? (
                <ModalShell onClose={() => setShowAdd(false)} labelledBy="cupping-add-title">
                    <div className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-xl bg-main-bg p-6 shadow-lg dark:border dark:border-[#585d61]">
                        <h2 id="cupping-add-title" className="mb-4 text-base font-semibold text-primary">
                            {t('cupping.addSamples')}
                        </h2>
                        <p className="mb-3 text-[12px] text-muted">{t('cupping.addSamplesHint')}</p>
                        <div className="mb-4 max-h-56 space-y-1 overflow-y-auto rounded-md border border-border-subtle p-2 dark:border-[#585d61]">
                            {roastOptions.length === 0 ? (
                                <div className="p-2 text-xs text-muted">{t('cupping.noRoasts')}</div>
                            ) : (
                                roastOptions.map((o) => (
                                    <label
                                        key={o.id}
                                        className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-[13px] hover:bg-surface"
                                    >
                                        <input
                                            type="checkbox"
                                            checked={selectedRoastIds.includes(o.id)}
                                            onChange={() => toggleRoast(o.id)}
                                        />
                                        <span className="text-primary">{o.label}</span>
                                    </label>
                                ))
                            )}
                        </div>
                        <label className="mb-4 flex flex-col gap-1 text-[12px] text-muted">
                            {t('cupping.freeLabel')}
                            <input
                                value={freeLabel}
                                onChange={(e) => setFreeLabel(e.target.value)}
                                placeholder={t('cupping.freeLabelPlaceholder')}
                                className="rounded-md border border-border-subtle bg-main-bg px-3 py-2 text-[13px] text-primary dark:border-[#585d61]"
                            />
                        </label>
                        {addError ? <div className="mb-3 text-xs text-red-600">{addError}</div> : null}
                        <div className="flex justify-end gap-2">
                            <button
                                type="button"
                                onClick={() => setShowAdd(false)}
                                className="rounded-full border border-border-subtle px-4 py-2 text-xs dark:border-[#585d61]"
                            >
                                {t('cupping.cancel')}
                            </button>
                            <button
                                type="button"
                                disabled={addSamples.isPending}
                                onClick={() => void handleAdd()}
                                className="rounded-full bg-primary px-4 py-2 text-xs font-medium text-white disabled:opacity-50"
                            >
                                {addSamples.isPending ? t('cupping.adding') : t('cupping.add')}
                            </button>
                        </div>
                    </div>
                </ModalShell>
            ) : null}

            {qrSample && activeUrl ? (
                <ModalShell onClose={() => setQrSample(null)} labelledBy="cupping-qr-title">
                    <div className="w-full max-w-sm rounded-xl bg-main-bg p-6 shadow-lg dark:border dark:border-[#585d61]">
                        <h2 id="cupping-qr-title" className="mb-1 text-base font-semibold text-primary">
                            {qrSample.label}
                        </h2>
                        <p className="mb-4 text-[12px] text-muted">{t('cupping.qrHint')}</p>
                        {qrSrc ? (
                            <img
                                src={qrSrc}
                                alt="QR"
                                width={180}
                                height={180}
                                className="mx-auto mb-4 rounded-md bg-white p-2"
                            />
                        ) : null}
                        <div className="mb-3 break-all font-mono text-[11px] text-secondary">{activeUrl}</div>
                        <div className="flex flex-wrap gap-2">
                            <button
                                type="button"
                                onClick={async () => {
                                    await navigator.clipboard.writeText(activeUrl);
                                    setCopied(true);
                                }}
                                className="inline-flex items-center gap-1 rounded-full border border-border-subtle px-3 py-1.5 text-xs dark:border-[#585d61]"
                            >
                                {copied ? <Check size={14} /> : <Copy size={14} />}
                                {copied ? t('cupping.copied') : t('cupping.copyLink')}
                            </button>
                            <a
                                href={activeUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 rounded-full border border-border-subtle px-3 py-1.5 text-xs dark:border-[#585d61]"
                            >
                                <Link2 size={14} />
                                {t('cupping.openLink')}
                            </a>
                            {qrSample.active_invite ? (
                                <button
                                    type="button"
                                    onClick={() => {
                                        const inviteId = qrSample.active_invite?.id;
                                        if (!inviteId) return;
                                        void revokeInvite.mutateAsync(inviteId).then(() => {
                                            setQrSample(null);
                                            void refetch();
                                        });
                                    }}
                                    className="rounded-full border border-border-subtle px-3 py-1.5 text-xs text-muted dark:border-[#585d61]"
                                >
                                    {t('cupping.revoke')}
                                </button>
                            ) : null}
                        </div>
                    </div>
                </ModalShell>
            ) : null}
        </PageLayout>
    );
}
