import {
    type CuppingEventSummary,
    type CuppingSampleWithMeta,
    formatBeanCuppingMeta,
    useAddCuppingSamples,
    useCreateCuppingEvent,
    useCreateEventInvite,
    useCuppingEvents,
    useCuppingSamples,
    useDeleteCuppingEvent,
    useDeleteCuppingSample,
    useEventInvite,
    useRevokeCuppingInvite,
} from '@entities/cupping';
import { useRoastSessions } from '@entities/roast';
import { FEATURE, useFeature } from '@shared/lib/features';
import { formatDateShort } from '@shared/lib/format';
import { useAuthStore } from '@shared/store/auth';
import { Badge } from '@shared/ui/Badge';
import { ModalShell } from '@shared/ui/modal-shell/ModalShell';
import { PageHeader } from '@shared/ui/PageHeader';
import { PageLayout } from '@shared/ui/PageLayout';
import { PillButton } from '@shared/ui/PillButton';
import { SurfaceButton } from '@shared/ui/SurfaceButton';
import { Check, ChevronLeft, Copy, Link2, Lock, Plus, QrCode, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CuppingEventListSkeleton, CuppingSampleListSkeleton } from './ui/CuppingSkeleton';

type CuppingProps = {
    onUpgrade?: () => void;
};

export const Cupping = ({ onUpgrade }: CuppingProps) => {
    const { t } = useTranslation();
    const canCupping = useFeature(FEATURE.cupping);
    const userId = useAuthStore((s) => s.user?.id ?? '');
    const { data: events = [], isLoading, isError, error, refetch } = useCuppingEvents(userId, canCupping);
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

    if (!canCupping) {
        return (
            <PageLayout>
                <PageHeader title={t('cupping.title')} subtitle={t('cupping.locked.subtitle')} />
                <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-border-subtle bg-main-bg px-6 py-20 text-center dark:border-[#585d61]">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-surface">
                        <Lock size={22} className="text-muted" />
                    </div>
                    <div>
                        <p className="text-[15px] font-medium text-primary">{t('cupping.locked.title')}</p>
                        <p className="mt-2 max-w-md text-[13px] leading-relaxed text-muted">
                            {t('cupping.locked.description')}
                        </p>
                    </div>
                    {onUpgrade ? <PillButton onClick={onUpgrade}>{t('cupping.locked.cta')}</PillButton> : null}
                </div>
            </PageLayout>
        );
    }

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
                        onClick={() => void refetch()}
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
                                    <td className="px-4 py-3">
                                        <Badge tone={ev.active_invite ? 'good' : 'muted'} size="sm">
                                            {ev.active_invite ? 'Link active' : 'No link yet'}
                                        </Badge>
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
    const { data: samples = [], isLoading } = useCuppingSamples(eventId);
    const { data: activeInvite } = useEventInvite(eventId);
    const { data: roastSessions = [] } = useRoastSessions(userId, 'completed');
    const addSamples = useAddCuppingSamples(userId, eventId);
    const deleteSample = useDeleteCuppingSample(userId, eventId);
    const createInvite = useCreateEventInvite(userId, eventId);
    const revokeInvite = useRevokeCuppingInvite(eventId, userId);
    const deleteEvent = useDeleteCuppingEvent(userId);

    const [showAdd, setShowAdd] = useState(false);
    const [selectedRoastIds, setSelectedRoastIds] = useState<string[]>([]);
    const [freeLabel, setFreeLabel] = useState('');
    const [showQr, setShowQr] = useState(false);
    const [qrUrl, setQrUrl] = useState<string | null>(null);
    const [qrInviteId, setQrInviteId] = useState<string | null>(null);
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
            roastSessions.map((s) => {
                const beanName = s.beans?.name ?? t('cupping.unknownBean');
                const beanMeta = formatBeanCuppingMeta(s.beans);
                return {
                    id: s.id,
                    /** Sample label stored on cupping_samples — bean name, not roast date */
                    label: beanName,
                    beanName,
                    beanMeta,
                    roastedAt: s.roasted_at,
                    roastLevel: s.roast_level,
                    profileName: s.roast_profiles?.name ?? null,
                };
            }),
        [roastSessions, t],
    );

    const toggleRoast = (id: string) => {
        setSelectedRoastIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    };

    const handleAdd = async () => {
        setAddError(null);
        const items: { label: string; roastSessionId?: string | null }[] = [];
        for (const id of selectedRoastIds) {
            const opt = roastOptions.find((o) => o.id === id);
            items.push({ label: opt?.label ?? t('cupping.unknownBean'), roastSessionId: id });
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
        } catch (e) {
            setAddError(e instanceof Error ? e.message : 'Failed');
        }
    };

    const handleQr = async () => {
        if (activeInvite) {
            setQrUrl(activeInvite.url);
            setQrInviteId(activeInvite.id);
            setShowQr(true);
            return;
        }
        const inv = await createInvite.mutateAsync({});
        setQrUrl(inv.url);
        setQrInviteId(inv.id);
        setShowQr(true);
    };

    const qrSrc = qrUrl
        ? `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(qrUrl)}`
        : null;

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

            {/* Session = container; samples inside; one QR for the whole session */}
            <div className="mb-5 rounded-xl border border-border-subtle bg-main-bg p-4 dark:border-[#585d61]">
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                        <div className="mb-1 flex flex-wrap items-center gap-2">
                            <p className="text-[13px] font-semibold text-primary tracking-[0.14px]">
                                {t('cupping.sessionPanelTitle')}
                            </p>
                            <Badge
                                tone={activeInvite || samples.length > 0 ? (activeInvite ? 'good' : 'muted') : 'muted'}
                                size="sm"
                            >
                                {activeInvite ? 'Link active' : 'No link yet'}
                            </Badge>
                        </div>
                        <p className="text-[12px] leading-relaxed text-muted tracking-[0.14px]">
                            {t('cupping.sessionPanelBody')}
                        </p>
                        {samples.length === 0 ? (
                            <p className="mt-2 text-[12px] text-secondary tracking-[0.14px]">
                                {t('cupping.sessionQrNeedSamples')}
                            </p>
                        ) : null}
                    </div>
                    <button
                        type="button"
                        onClick={() => void handleQr()}
                        disabled={createInvite.isPending || samples.length === 0}
                        className="inline-flex items-center gap-1.5 rounded-full border border-border-subtle bg-transparent px-4 py-2 text-[12px] font-medium text-primary transition-colors hover:bg-surface disabled:cursor-not-allowed disabled:opacity-40 dark:border-[#585d61] dark:hover:bg-surface-elevated cursor-pointer"
                    >
                        <QrCode size={14} strokeWidth={1.75} />
                        {t('cupping.sessionQr')}
                    </button>
                </div>
            </div>

            {isLoading ? (
                <CuppingSampleListSkeleton />
            ) : samples.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-border-subtle bg-main-bg px-6 py-16 text-center dark:border-[#585d61]">
                    <p className="max-w-md text-[13px] leading-relaxed text-muted tracking-[0.14px]">
                        {t('cupping.noSamples')}
                    </p>
                    <SurfaceButton
                        onClick={() => setShowAdd(true)}
                        icon={<Plus size={14} strokeWidth={2} />}
                        className="px-4 py-2"
                    >
                        {t('cupping.addSamples')}
                    </SurfaceButton>
                </div>
            ) : (
                <div className="overflow-x-auto rounded-xl border border-border-subtle bg-main-bg dark:border-[#585d61]">
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
                                    {t('cupping.colBean')}
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
                            {samples.map((s: CuppingSampleWithMeta, i: number) => {
                                const bean = s.roast_sessions?.beans ?? null;
                                const beanMeta = formatBeanCuppingMeta(bean);
                                return (
                                    <tr
                                        key={s.id}
                                        className="border-b border-border-subtle last:border-0 transition-colors hover:bg-surface/50 dark:border-[#585d61]"
                                    >
                                        <td className="px-4 py-3 font-mono text-[12px] text-muted">{i + 1}</td>
                                        <td className="px-4 py-3 text-[13px] font-medium text-primary">{s.label}</td>
                                        <td className="px-4 py-3">
                                            {bean ? (
                                                <div>
                                                    <div className="text-[13px] font-medium text-primary">
                                                        {bean.name}
                                                    </div>
                                                    {beanMeta ? (
                                                        <div className="mt-0.5 text-[11px] leading-snug text-muted">
                                                            {beanMeta}
                                                        </div>
                                                    ) : null}
                                                </div>
                                            ) : (
                                                <span className="text-[12px] text-muted">
                                                    {t('cupping.noRoastLink')}
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-4 py-3 text-[12px] text-secondary">
                                            {s.roast_sessions
                                                ? formatDateShort(s.roast_sessions.roasted_at)
                                                : t('cupping.noRoastLink')}
                                        </td>
                                        <td className="px-4 py-3 font-mono text-[13px] text-secondary">
                                            {s.score_count}
                                        </td>
                                        <td className="px-4 py-3 font-mono text-[13px] text-secondary">
                                            {s.avg_score != null ? s.avg_score.toFixed(2) : '—'}
                                        </td>
                                        <td className="px-4 py-3">
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    if (window.confirm(t('cupping.deleteSampleConfirm'))) {
                                                        void deleteSample.mutateAsync(s.id);
                                                    }
                                                }}
                                                className="inline-flex h-7 w-7 items-center justify-center rounded-full text-muted transition-colors hover:bg-red-500/10 hover:text-red-500 cursor-pointer"
                                                aria-label={t('common.delete')}
                                            >
                                                <Trash2 size={13} strokeWidth={1.75} />
                                            </button>
                                        </td>
                                    </tr>
                                );
                            })}
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
                                        className="flex cursor-pointer items-start gap-2.5 rounded-lg px-2 py-2 text-[13px] hover:bg-surface"
                                    >
                                        <input
                                            type="checkbox"
                                            className="mt-1"
                                            checked={selectedRoastIds.includes(o.id)}
                                            onChange={() => toggleRoast(o.id)}
                                        />
                                        <span className="min-w-0 flex-1">
                                            <span className="block font-medium text-primary">{o.beanName}</span>
                                            {o.beanMeta ? (
                                                <span className="mt-0.5 block text-[11px] leading-snug text-muted">
                                                    {o.beanMeta}
                                                </span>
                                            ) : null}
                                            <span className="mt-0.5 block font-mono text-[11px] text-secondary">
                                                {formatDateShort(o.roastedAt)}
                                                {o.roastLevel ? ` · ${o.roastLevel}` : ''}
                                                {o.profileName ? ` · ${o.profileName}` : ''}
                                            </span>
                                        </span>
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

            {showQr && qrUrl ? (
                <ModalShell
                    onClose={() => {
                        setShowQr(false);
                        setQrUrl(null);
                        setQrInviteId(null);
                    }}
                    labelledBy="cupping-qr-title"
                >
                    <div className="w-full max-w-sm rounded-xl bg-main-bg p-6 shadow-lg dark:border dark:border-[#585d61]">
                        <h2 id="cupping-qr-title" className="mb-1 text-base font-semibold text-primary">
                            {title}
                        </h2>
                        <p className="mb-4 text-[12px] text-muted">{t('cupping.sessionQrHint')}</p>
                        {qrSrc ? (
                            <img
                                src={qrSrc}
                                alt="QR"
                                width={180}
                                height={180}
                                className="mx-auto mb-4 rounded-md bg-white p-2"
                            />
                        ) : null}
                        <div className="mb-3 break-all font-mono text-[11px] text-secondary">{qrUrl}</div>
                        <div className="flex flex-wrap gap-2">
                            <button
                                type="button"
                                onClick={async () => {
                                    await navigator.clipboard.writeText(qrUrl);
                                    setCopied(true);
                                }}
                                className="inline-flex items-center gap-1 rounded-full border border-border-subtle px-3 py-1.5 text-xs dark:border-[#585d61]"
                            >
                                {copied ? <Check size={14} /> : <Copy size={14} />}
                                {copied ? t('cupping.copied') : t('cupping.copyLink')}
                            </button>
                            <a
                                href={qrUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 rounded-full border border-border-subtle px-3 py-1.5 text-xs dark:border-[#585d61]"
                            >
                                <Link2 size={14} />
                                {t('cupping.openLink')}
                            </a>
                            {qrInviteId ? (
                                <button
                                    type="button"
                                    onClick={() => {
                                        void revokeInvite.mutateAsync(qrInviteId).then(() => {
                                            setShowQr(false);
                                            setQrUrl(null);
                                            setQrInviteId(null);
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
