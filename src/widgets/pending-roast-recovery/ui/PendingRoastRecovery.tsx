import { useBeans } from '@entities/bean';
import { useActiveWorkspace } from '@entities/organization';
import { useDayBatches } from '@entities/plan';
import { isPendingRoastSaveActive } from '@features/active-roast/lib/resumePendingRoastSave';
import { formatRoastSaveError } from '@features/active-roast/lib/saveErrorClassification';
import { toPlanBatchHandoff } from '@features/active-roast/lib/toPlanBatchHandoff';
import {
    clearPendingRoastSave,
    listPendingRoastSaves,
    type PendingRoastSave,
    writePendingRoastSave,
} from '@features/active-roast/model/pendingRoastSave';
import { useRoastingStore } from '@features/active-roast/model/status';
import { usePendingRoastCharges } from '@features/active-roast/model/usePendingRoastCharges';
import { useSaveRoast } from '@features/active-roast/model/useSaveRoast';
import { useUploadRoastProfile } from '@features/upload-roast-profile';
import { formatElapsed } from '@shared/lib/format';
import { useFormEscape } from '@shared/lib/useFormEscape';
import { useAuthStore } from '@shared/store/auth';
import { useCatalogVisibility } from '@shared/store/catalog-visibility';
import { Badge } from '@shared/ui/Badge';
import { FormSelect } from '@shared/ui/FormSelect';
import { inputCls, modalFooterChrome, modalHeaderChrome } from '@shared/ui/form-styles';
import { ModalShell } from '@shared/ui/modal-shell/ModalShell';
import { modalPanel } from '@shared/ui/modal-shell/modalPanel';
import { PillButton } from '@shared/ui/PillButton';
import { SurfaceButton } from '@shared/ui/SurfaceButton';
import { format } from 'date-fns';
import { ArchiveRestore, ChevronDown, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

const load = () => {
    try {
        return { items: listPendingRoastSaves(), error: '' };
    } catch (err) {
        return { items: [] as PendingRoastSave[], error: formatRoastSaveError(err) };
    }
};

/** Pending items stay visible until synchronized or explicitly discarded. */
export const PendingRoastRecovery = ({ onReview }: { onReview: (ownerId: string, sessionId: string) => void }) => {
    const { t } = useTranslation();
    const { workspaceOwnerId, isWorkspaceReady } = useActiveWorkspace();
    const completed = useRoastingStore((store) => store.completed);
    usePendingRoastCharges(workspaceOwnerId, isWorkspaceReady);
    const [state, setState] = useState(load);
    const [open, setOpen] = useState(false);
    const [discardTarget, setDiscardTarget] = useState<PendingRoastSave | null>(null);
    const [discardError, setDiscardError] = useState('');
    useFormEscape(open && !discardTarget, () => setOpen(false));
    const { mutateAsync: syncRoastCurve } = useUploadRoastProfile();
    const { resumeSave } = useSaveRoast(null, syncRoastCurve);
    const recover = useCallback(
        async (pending: PendingRoastSave) => {
            const result = await resumeSave(pending);
            const store = useRoastingStore.getState();
            if (result.savedSession.batch_name) {
                store.replaceReviewTitle(
                    pending.params.sessionId ?? '',
                    pending.params.userId,
                    result.savedSession.batch_name,
                );
            }
            store.saveSucceeded(pending.params.userId, pending.params.sessionId);
            return result;
        },
        [resumeSave],
    );
    const attempted = useRef(new Set<string>());
    const refresh = useCallback(() => setState(load()), []);
    const closeDiscard = () => {
        setDiscardTarget(null);
        setDiscardError('');
    };
    useEffect(() => {
        if (!discardTarget) return;
        const onKey = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            // Capture + stop so a parent list listener cannot close underneath this confirm.
            event.preventDefault();
            event.stopImmediatePropagation();
            setDiscardTarget(null);
            setDiscardError('');
        };
        document.addEventListener('keydown', onKey, true);
        return () => document.removeEventListener('keydown', onKey, true);
    }, [discardTarget]);
    const confirmDiscard = () => {
        if (!discardTarget) return;
        if (isPendingRoastSaveActive(discardTarget.params.userId, discardTarget.params.sessionId)) {
            closeDiscard();
            return;
        }
        try {
            clearPendingRoastSave(discardTarget.params.userId, discardTarget.params.sessionId);
            closeDiscard();
            refresh();
        } catch (err) {
            setDiscardError(formatRoastSaveError(err));
        }
    };
    useEffect(() => {
        window.addEventListener('fc-pending-roast-save', refresh);
        window.addEventListener('storage', refresh);
        return () => {
            window.removeEventListener('fc-pending-roast-save', refresh);
            window.removeEventListener('storage', refresh);
        };
    }, [refresh]);
    useEffect(() => {
        if (!isWorkspaceReady) return;
        for (const pending of state.items) {
            const key = `${pending.params.userId}:${pending.params.sessionId}`;
            if (
                !pending.submitted ||
                pending.needsAttention ||
                pending.params.userId !== workspaceOwnerId ||
                attempted.current.has(key)
            )
                continue;
            attempted.current.add(key);
            void recover(pending)
                .catch(() => {})
                .finally(refresh);
        }
    }, [state.items, isWorkspaceReady, workspaceOwnerId, recover, refresh]);
    const items = state.items.filter((p) => p.params.userId === workspaceOwnerId);
    const current =
        completed?.summary && !completed.submitted && completed.snapshot.sessionOwnerId === workspaceOwnerId
            ? completed
            : null;
    const checkpoint = current ? items.find((p) => p.params.sessionId === current.snapshot.sessionId) : null;
    const reviewCurrent = current && checkpoint?.db !== 'saved' ? current : null;
    const summaryOnly = reviewCurrent && !checkpoint?.submitted && !checkpoint?.needsAttention ? reviewCurrent : null;
    const remaining = summaryOnly ? items.filter((p) => p !== checkpoint) : items;
    const count = remaining.length + (summaryOnly ? 1 : 0);
    const currentBusy = Boolean(
        reviewCurrent && isPendingRoastSaveActive(workspaceOwnerId, reviewCurrent.snapshot.sessionId),
    );
    if (!isWorkspaceReady || (!state.error && count === 0)) return null;
    return (
        <>
            <button
                type="button"
                onClick={() => setOpen(true)}
                aria-haspopup="dialog"
                className="fixed bottom-4 right-4 z-50 inline-flex items-center gap-2 rounded-full border border-border bg-main-bg px-4 py-3 text-sm font-medium text-primary shadow-lg transition-colors hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-strong-border"
            >
                <ArchiveRestore size={16} strokeWidth={1.5} aria-hidden="true" />
                {t('activeRoast.recovery.pending', { count })}
            </button>
            {open && (
                <ModalShell
                    onClose={() => setOpen(false)}
                    labelledBy="pending-roasts-title"
                    overlayClassName="z-[10000]"
                    contentClassName={modalPanel.formMd}
                >
                    <header className={`${modalHeaderChrome} flex items-start justify-between gap-4 px-6 py-5`}>
                        <div>
                            <h2 id="pending-roasts-title" className="text-lg font-semibold text-primary">
                                {t('activeRoast.recovery.title')}
                            </h2>
                            <p className="mt-1 text-sm text-muted">{t('activeRoast.recovery.description')}</p>
                        </div>
                        <SurfaceButton
                            onClick={() => setOpen(false)}
                            aria-label={t('common.close')}
                            className="w-8 px-0"
                        >
                            <X size={16} strokeWidth={1.5} aria-hidden="true" />
                        </SurfaceButton>
                    </header>
                    <div className="min-h-0 space-y-3 overflow-auto p-6">
                        {state.error && (
                            <p role="alert" className="text-sm text-red-500">
                                {state.error}
                            </p>
                        )}
                        {summaryOnly && (
                            <section
                                data-testid="pending-roast-current"
                                className="rounded-2xl border border-border bg-main-bg p-4"
                            >
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <h3 className="text-sm font-medium text-primary">
                                        {summaryOnly.summary?.batchName ||
                                            summaryOnly.snapshot.selection.beanName ||
                                            t('activeRoast.recovery.title')}
                                    </h3>
                                    <Badge tone={checkpoint?.error ? 'bad' : 'amber'}>
                                        {t(
                                            currentBusy
                                                ? 'activeRoast.recovery.working'
                                                : checkpoint?.error
                                                  ? 'activeRoast.recovery.needsAttention'
                                                  : 'activeRoast.recovery.savePending',
                                        )}
                                    </Badge>
                                </div>
                                <p className="mt-1 text-xs text-muted">
                                    {summaryOnly.snapshot.roastStartMs > 0 &&
                                        `${format(summaryOnly.snapshot.roastStartMs, 'yyyy-MM-dd HH:mm')} · `}
                                    {summaryOnly.summary?.totalTime}
                                </p>
                                {checkpoint?.error && (
                                    <p role="alert" className="mt-3 text-sm text-red-500">
                                        {checkpoint.error}
                                    </p>
                                )}
                                <PillButton
                                    className="mt-4"
                                    disabled={currentBusy}
                                    onClick={() => {
                                        onReview(workspaceOwnerId, summaryOnly.snapshot.sessionId);
                                        setOpen(false);
                                    }}
                                >
                                    {t('activeRoast.recovery.review')}
                                </PillButton>
                            </section>
                        )}
                        {remaining.map((pending) => (
                            <RecoveryItem
                                key={`${pending.params.userId}:${pending.params.sessionId}`}
                                pending={pending}
                                retry={recover}
                                refresh={refresh}
                                onReview={
                                    reviewCurrent && pending === checkpoint
                                        ? () => {
                                              onReview(workspaceOwnerId, reviewCurrent.snapshot.sessionId);
                                              setOpen(false);
                                          }
                                        : undefined
                                }
                                onRequestDiscard={() => {
                                    if (isPendingRoastSaveActive(pending.params.userId, pending.params.sessionId))
                                        return;
                                    setDiscardError('');
                                    setDiscardTarget(pending);
                                }}
                            />
                        ))}
                    </div>
                    <footer className={`${modalFooterChrome} flex justify-end`}>
                        <SurfaceButton onClick={() => setOpen(false)}>{t('common.close')}</SurfaceButton>
                    </footer>
                </ModalShell>
            )}
            {discardTarget && (
                <ModalShell
                    onClose={closeDiscard}
                    labelledBy="pending-roast-discard-title"
                    overlayClassName="z-[10001]"
                    contentClassName={modalPanel.sm}
                    data-testid="pending-roast-discard-modal"
                >
                    <h2 id="pending-roast-discard-title" className="mb-4 text-lg font-semibold">
                        {t('activeRoast.recovery.discard')}
                    </h2>
                    <p className="mb-4 text-sm text-muted">{t('activeRoast.recovery.discardConfirm')}</p>
                    {discardError && (
                        <p role="alert" className="mb-4 text-sm text-red-500">
                            {discardError}
                        </p>
                    )}
                    <div className="flex gap-2">
                        <SurfaceButton onClick={closeDiscard}>{t('common.cancel')}</SurfaceButton>
                        <SurfaceButton
                            type="button"
                            data-testid="pending-roast-discard-confirm"
                            onClick={confirmDiscard}
                            className="text-red-500"
                        >
                            {t('activeRoast.recovery.discard')}
                        </SurfaceButton>
                    </div>
                </ModalShell>
            )}
        </>
    );
};

const RecoveryItem = ({
    pending,
    retry,
    refresh,
    onRequestDiscard,
    onReview,
}: {
    pending: PendingRoastSave;
    retry: (p: PendingRoastSave) => Promise<unknown>;
    refresh: () => void;
    onRequestDiscard: () => void;
    onReview?: () => void;
}) => {
    const { t } = useTranslation();
    const [draft, setDraft] = useState(pending);
    const [working, setBusy] = useState(false);
    const busy = working || isPendingRoastSaveActive(pending.params.userId, pending.params.sessionId);
    const running = useRef(false);
    const [error, setError] = useState('');
    const [date, setDate] = useState(() => format(new Date(), 'yyyy-MM-dd'));
    const authUserId = useAuthStore((state) => state.user?.id ?? '');
    const { hidden } = useCatalogVisibility(authUserId, pending.params.userId, 'beans');
    const { data: beans = [] } = useBeans(pending.params.userId);
    const { data: batches = [] } = useDayBatches(pending.params.userId, date);
    const form = draft.params.formData;
    const linked = draft.params.planBatchHandoff ?? form.linkedBatch;
    const editable = pending.db !== 'saved' && Boolean(pending.params.sessionId);
    const updateForm = (patch: Partial<typeof form>) =>
        setDraft({ ...draft, params: { ...draft.params, formData: { ...form, ...patch } } });
    const run = async () => {
        if (running.current || isPendingRoastSaveActive(pending.params.userId, pending.params.sessionId)) return;
        running.current = true;
        setBusy(true);
        setError('');
        try {
            const next =
                pending.db === 'saved'
                    ? {
                          ...pending,
                          legacyBbpUnknown: draft.legacyBbpUnknown,
                          bbp: draft.legacyBbpUnknown === false ? draft.bbp : pending.bbp,
                      }
                    : { ...draft, submitted: true, needsAttention: false, error: undefined };
            writePendingRoastSave(next);
            await retry(next);
        } catch (err) {
            setError(formatRoastSaveError(err));
        } finally {
            running.current = false;
            setBusy(false);
            refresh();
        }
    };
    return (
        <section className="space-y-3 rounded-2xl border border-border bg-main-bg p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-medium text-primary">
                    {pending.params.formData.batchName ||
                        pending.params.handoffBeanName ||
                        pending.params.formData.beanLabel ||
                        t('activeRoast.recovery.title')}
                </h3>
                <Badge tone={pending.db === 'saved' ? 'blue' : error || pending.error ? 'bad' : 'amber'}>
                    {t(
                        busy
                            ? 'activeRoast.recovery.working'
                            : pending.db === 'saved'
                              ? 'activeRoast.recovery.syncStatus'
                              : error || pending.error
                                ? 'activeRoast.recovery.needsAttention'
                                : 'activeRoast.recovery.savePending',
                    )}
                </Badge>
            </div>
            <p className="text-xs text-muted">
                {pending.params.roastStartTime > 0 && `${format(pending.params.roastStartTime, 'yyyy-MM-dd HH:mm')} · `}
                {formatElapsed(pending.params.elapsed)}
            </p>
            {(error || pending.error) && (
                <p role="alert" className="text-sm text-red-500">
                    {error || pending.error}
                </p>
            )}
            {pending.legacyBbpUnknown && (
                <label className="block text-sm">
                    <input
                        type="checkbox"
                        disabled={busy}
                        checked={draft.legacyBbpUnknown === false}
                        onChange={(e) =>
                            setDraft({
                                ...draft,
                                legacyBbpUnknown: !e.target.checked,
                                bbp: e.target.checked ? 'not_required' : 'pending',
                            })
                        }
                    />
                    {t('activeRoast.recovery.noBbp')}
                </label>
            )}
            {editable && (
                <details className="group rounded-xl border border-border">
                    <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2 text-sm font-medium text-secondary focus-visible:outline-2 focus-visible:outline-strong-border">
                        {t('activeRoast.recovery.editDetails')}
                        <ChevronDown
                            size={16}
                            strokeWidth={1.5}
                            className="transition-transform group-open:rotate-180"
                            aria-hidden="true"
                        />
                    </summary>
                    <fieldset disabled={busy} className="grid gap-3 border-t border-border p-3 sm:grid-cols-2">
                        <label className="block text-sm">
                            {t('activeRoast.recovery.bean')}
                            <FormSelect
                                value={form.beanId ?? ''}
                                onChange={(e) => updateForm({ beanId: e.target.value || null })}
                            >
                                <option value="">{t('activeRoast.recovery.noBean')}</option>
                                {beans
                                    .filter((bean) => bean.id === form.beanId || !hidden.has(bean.id))
                                    .map((bean) => (
                                        <option key={bean.id} value={bean.id}>
                                            {bean.name}
                                        </option>
                                    ))}
                            </FormSelect>
                        </label>
                        <label className="block text-sm">
                            {t('activeRoast.recovery.inputWeight')}
                            <input
                                className={inputCls}
                                type="number"
                                min={0}
                                step="any"
                                value={form.weightGrams}
                                onChange={(e) => {
                                    const value = e.currentTarget.valueAsNumber;
                                    updateForm({ weightGrams: Number.isFinite(value) ? value : 0 });
                                }}
                            />
                        </label>
                        <label className="block text-sm">
                            {t('activeRoast.recovery.outputWeight')}
                            <input
                                className={inputCls}
                                type="number"
                                min={0}
                                step="any"
                                value={form.outputWeightKg ?? ''}
                                onChange={(e) =>
                                    updateForm({
                                        outputWeightKg: Number.isFinite(e.currentTarget.valueAsNumber)
                                            ? e.currentTarget.valueAsNumber
                                            : undefined,
                                    })
                                }
                            />
                        </label>
                        <label className="block text-sm">
                            {t('activeRoast.recovery.scheduleDate')}
                            <input
                                className={inputCls}
                                type="date"
                                value={date}
                                onChange={(e) => setDate(e.target.value)}
                            />
                        </label>
                        <label className="block text-sm">
                            {t('activeRoast.recovery.batch')}
                            <FormSelect
                                value={linked?.planBatchId ?? form.linkedBatchId ?? ''}
                                onChange={(e) => {
                                    const row = batches.find((b) => b.id === e.target.value);
                                    setDraft({
                                        ...draft,
                                        batch: row ? 'pending' : 'not_required',
                                        params: {
                                            ...draft.params,
                                            planBatchHandoff: null,
                                            formData: {
                                                ...form,
                                                beanId: form.beanId ?? linked?.beanId ?? null,
                                                linkedBatch: row ? toPlanBatchHandoff(row) : null,
                                                linkedBatchId: row?.id ?? null,
                                            },
                                        },
                                    });
                                }}
                            >
                                <option value="">{t('activeRoast.recovery.unlink')}</option>
                                {linked && !batches.some((b) => b.id === linked.planBatchId) && (
                                    <option value={linked.planBatchId}>{linked.beanName}</option>
                                )}
                                {batches.map((b) => (
                                    <option key={b.id} value={b.id}>
                                        {b.bean_name} ({b.completed_sessions}/{b.batch_count})
                                    </option>
                                ))}
                            </FormSelect>
                        </label>
                    </fieldset>
                </details>
            )}
            <div className="flex gap-2">
                {onReview && (
                    <PillButton disabled={busy} onClick={onReview} className="h-8 px-3 py-1.5 text-xs">
                        {t('activeRoast.recovery.review')}
                    </PillButton>
                )}
                <PillButton
                    type="button"
                    disabled={busy || !pending.params.sessionId}
                    onClick={() => void run()}
                    className="h-8 px-3 py-1.5 text-xs"
                >
                    {t('activeRoast.recovery.retry')}
                </PillButton>
                {!onReview && (
                    <SurfaceButton type="button" disabled={busy} onClick={onRequestDiscard} className="text-red-500">
                        {t('activeRoast.recovery.discard')}
                    </SurfaceButton>
                )}
            </div>
        </section>
    );
};
