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
import { cn } from '@shared/lib/cn';
import { formatElapsed } from '@shared/lib/format';
import { useAuthStore } from '@shared/store/auth';
import { useCatalogVisibility } from '@shared/store/catalog-visibility';
import { FormSelect } from '@shared/ui/FormSelect';
import { inputCls, modalFooterChrome, modalHeaderChrome } from '@shared/ui/form-styles';
import { ModalShell } from '@shared/ui/modal-shell/ModalShell';
import { modalPanel } from '@shared/ui/modal-shell/modalPanel';
import { PillButton } from '@shared/ui/PillButton';
import { SurfaceButton } from '@shared/ui/SurfaceButton';
import { format } from 'date-fns';
import {
    ArchiveRestore,
    ChevronDown,
    CircleAlert,
    CircleDashed,
    CloudUpload,
    LoaderCircle,
    Trash2,
    X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useRecoveryModalFocus } from './useRecoveryModalFocus';

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
    const listDialog = useRef<HTMLDivElement>(null);
    const discardDialog = useRef<HTMLDivElement>(null);
    const modalWorkspace = useRef(workspaceOwnerId);
    useEffect(() => {
        if (isWorkspaceReady && modalWorkspace.current === workspaceOwnerId) return;
        modalWorkspace.current = workspaceOwnerId;
        setOpen(false);
        setDiscardTarget(null);
        setDiscardError('');
    }, [workspaceOwnerId, isWorkspaceReady]);
    useEffect(() => {
        if (!open || discardTarget) return;
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape' && !event.defaultPrevented && !document.querySelector('[role="listbox"]'))
                setOpen(false);
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [open, discardTarget]);
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
    const visible = isWorkspaceReady && Boolean(state.error || count);
    useRecoveryModalFocus(open && visible, listDialog, Boolean(discardTarget));
    useRecoveryModalFocus(Boolean(discardTarget) && visible, discardDialog);
    if (!visible) return null;
    return (
        <>
            <button
                type="button"
                onClick={() => setOpen(true)}
                aria-haspopup="dialog"
                data-testid="pending-roast-trigger"
                className="fixed bottom-4 right-4 z-50 inline-flex items-center gap-2 rounded-full border border-border bg-main-bg px-4 py-3 text-sm font-medium text-primary shadow-lg transition-colors hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary"
            >
                <ArchiveRestore size={16} strokeWidth={1.5} aria-hidden="true" />
                {t('activeRoast.recovery.pending', { count })}
            </button>
            {open && (
                <ModalShell
                    ref={listDialog}
                    onClose={() => setOpen(false)}
                    labelledBy="pending-roasts-title"
                    overlayClassName="z-[10000] p-3 sm:p-6"
                    contentClassName={cn(
                        modalPanel.compareWorkspace,
                        'max-w-[600px] max-h-[calc(100dvh-24px)] text-primary sm:max-h-[calc(100dvh-48px)]',
                    )}
                >
                    <header className={`${modalHeaderChrome} flex items-start justify-between gap-4 px-4 py-5 sm:px-6`}>
                        <div className="min-w-0">
                            <h2
                                id="pending-roasts-title"
                                className="text-lg font-semibold leading-[1.3] text-primary text-balance"
                            >
                                {t('activeRoast.recovery.title')}
                            </h2>
                            <p className="mt-2 text-sm leading-[1.5] text-secondary text-pretty">
                                {t('activeRoast.recovery.description')}
                            </p>
                        </div>
                        <SurfaceButton
                            onClick={() => setOpen(false)}
                            aria-label={t('common.close')}
                            data-autofocus
                            data-testid="pending-roast-close"
                            className="h-10 w-10 shrink-0 px-0 focus-visible:outline-secondary"
                        >
                            <X size={16} strokeWidth={1.5} aria-hidden="true" />
                        </SurfaceButton>
                    </header>
                    <div className="min-h-0 space-y-4 overflow-auto overscroll-contain px-4 py-5 sm:px-6">
                        {state.error && <RecoveryError detail={state.error} help="loadHelp" />}
                        {summaryOnly && (
                            <section
                                data-testid="pending-roast-current"
                                className="@container rounded-xl border border-border bg-main-bg p-4"
                            >
                                <RecoveryHeading
                                    title={
                                        summaryOnly.summary?.batchName ||
                                        summaryOnly.snapshot.selection.beanName ||
                                        t('activeRoast.recovery.title')
                                    }
                                    startMs={summaryOnly.snapshot.roastStartMs}
                                    elapsed={summaryOnly.snapshot.elapsed}
                                    status={
                                        currentBusy ? 'working' : checkpoint?.error ? 'needsAttention' : 'savePending'
                                    }
                                />
                                <p className="mt-3 text-sm leading-[1.5] text-secondary">
                                    {t('activeRoast.recovery.reviewHelp')}
                                </p>
                                {checkpoint?.error && <RecoveryError detail={checkpoint.error} help="reviewHelp" />}
                                <PillButton
                                    className="mt-4 h-auto min-h-10 max-w-full whitespace-normal text-center focus-visible:outline-secondary"
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
                    <footer
                        className={`${modalFooterChrome} flex flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6`}
                    >
                        <p className="text-xs leading-[1.5] text-secondary">{t('activeRoast.recovery.retained')}</p>
                        <SurfaceButton
                            onClick={() => setOpen(false)}
                            className="h-auto min-h-10 whitespace-normal focus-visible:outline-secondary"
                        >
                            {t('common.close')}
                        </SurfaceButton>
                    </footer>
                </ModalShell>
            )}
            {discardTarget && (
                <ModalShell
                    ref={discardDialog}
                    onClose={closeDiscard}
                    labelledBy="pending-roast-discard-title"
                    overlayClassName="z-[10001] p-3 sm:p-6"
                    contentClassName={cn(
                        modalPanel.compareWorkspace,
                        'max-w-[420px] max-h-[calc(100dvh-24px)] overflow-auto overscroll-contain p-5 text-primary sm:p-7',
                    )}
                    data-testid="pending-roast-discard-modal"
                >
                    <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-(--color-phase-danger-bg) text-(--color-phase-danger)">
                        <Trash2 size={20} strokeWidth={1.5} aria-hidden="true" />
                    </div>
                    <h2 id="pending-roast-discard-title" className="text-lg font-semibold leading-[1.3] text-balance">
                        {t('activeRoast.recovery.discardTitle')}
                    </h2>
                    <p className="mt-3 break-words text-sm font-medium leading-[1.5]">
                        {discardTarget.params.formData.batchName ||
                            discardTarget.params.handoffBeanName ||
                            discardTarget.params.formData.beanLabel ||
                            t('activeRoast.recovery.title')}
                    </p>
                    <p className="mt-2 text-sm leading-[1.5] text-secondary">
                        {t(
                            discardTarget.db === 'saved'
                                ? 'activeRoast.recovery.discardSavedConfirm'
                                : 'activeRoast.recovery.discardConfirm',
                        )}
                    </p>
                    {discardError && <RecoveryError detail={discardError} help="discardHelp" />}
                    <div className="mt-6 flex flex-wrap justify-end gap-3">
                        <SurfaceButton
                            data-autofocus
                            onClick={closeDiscard}
                            className="h-auto min-h-10 whitespace-normal focus-visible:outline-secondary"
                        >
                            {t('common.cancel')}
                        </SurfaceButton>
                        <SurfaceButton
                            type="button"
                            data-testid="pending-roast-discard-confirm"
                            onClick={confirmDiscard}
                            className="h-auto min-h-10 max-w-full whitespace-normal border-(--color-phase-danger) bg-main-bg text-(--color-phase-danger) hover:bg-main-bg focus-visible:outline-secondary"
                        >
                            {t('activeRoast.recovery.discard')}
                        </SurfaceButton>
                    </div>
                </ModalShell>
            )}
        </>
    );
};

const RecoveryHeading = ({
    title,
    startMs,
    elapsed,
    status,
}: {
    title: string;
    startMs: number;
    elapsed: number;
    status: 'working' | 'syncStatus' | 'needsAttention' | 'savePending';
}) => {
    const { t, i18n } = useTranslation();
    const locale = i18n?.language ?? 'en';
    const dateFormatter = useMemo(
        () =>
            new Intl.DateTimeFormat(locale, {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
            }),
        [locale],
    );
    const Icon =
        status === 'working'
            ? LoaderCircle
            : status === 'syncStatus'
              ? CloudUpload
              : status === 'needsAttention'
                ? CircleAlert
                : CircleDashed;
    return (
        <div className="space-y-2">
            <h3 className="break-words text-base font-medium leading-[1.5] text-primary">{title}</h3>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs leading-[1.5] text-secondary">
                {startMs > 0 && <time dateTime={new Date(startMs).toISOString()}>{dateFormatter.format(startMs)}</time>}
                <span>{t('activeRoast.recovery.duration', { time: formatElapsed(elapsed) })}</span>
            </div>
            <p
                role="status"
                className="inline-flex items-center gap-1.5 text-xs font-medium leading-[1.5] text-secondary"
            >
                <Icon
                    size={14}
                    strokeWidth={1.5}
                    aria-hidden="true"
                    className={status === 'working' ? 'motion-safe:animate-spin' : undefined}
                />
                {t(`activeRoast.recovery.${status}`)}
            </p>
        </div>
    );
};

const RecoveryError = ({
    detail,
    help,
}: {
    detail: string;
    help: 'loadHelp' | 'reviewHelp' | 'retryHelp' | 'syncHelp' | 'correctionHelp' | 'discardHelp';
}) => {
    const { t } = useTranslation();
    return (
        <div role="alert" className="my-3 rounded-lg bg-(--color-phase-danger-bg) p-3 text-sm leading-[1.5]">
            <p className="flex items-start gap-2 font-medium text-primary">
                <CircleAlert
                    className="mt-0.5 shrink-0 text-(--color-phase-danger)"
                    size={16}
                    strokeWidth={1.5}
                    aria-hidden="true"
                />
                {t('activeRoast.recovery.attentionTitle')}
            </p>
            <p className="mt-2 text-primary">{t(`activeRoast.recovery.${help}`)}</p>
            <details className="mt-2 text-secondary">
                <summary className="w-fit cursor-pointer rounded py-1 text-xs underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-secondary">
                    {t('activeRoast.recovery.errorDetails')}
                </summary>
                <p className="mt-1 break-words text-xs leading-[1.5]">{detail}</p>
            </details>
        </div>
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
        <section className="@container space-y-4 rounded-xl border border-border bg-main-bg p-4" aria-busy={busy}>
            <RecoveryHeading
                title={
                    pending.params.formData.batchName ||
                    pending.params.handoffBeanName ||
                    pending.params.formData.beanLabel ||
                    t('activeRoast.recovery.title')
                }
                startMs={pending.params.roastStartTime}
                elapsed={pending.params.elapsed}
                status={
                    busy
                        ? 'working'
                        : pending.db === 'saved'
                          ? 'syncStatus'
                          : error || pending.error
                            ? 'needsAttention'
                            : 'savePending'
                }
            />
            {pending.db === 'saved' && (
                <p className="text-sm leading-[1.5] text-secondary">{t('activeRoast.recovery.syncHelp')}</p>
            )}
            {(error || pending.error) && (
                <RecoveryError
                    detail={error || pending.error || ''}
                    help={pending.db === 'saved' ? 'syncHelp' : pending.needsAttention ? 'correctionHelp' : 'retryHelp'}
                />
            )}
            {pending.legacyBbpUnknown && (
                <label className="flex items-start gap-2 text-sm leading-[1.5] text-secondary">
                    <input
                        type="checkbox"
                        className="mt-0.5 h-4 w-4 shrink-0 accent-action focus-visible:outline-2 focus-visible:outline-secondary"
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
                <details className="group rounded-lg bg-surface">
                    <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm font-medium leading-[1.5] text-secondary focus-visible:outline-2 focus-visible:outline-secondary">
                        {t('activeRoast.recovery.editDetails')}
                        <ChevronDown
                            size={16}
                            strokeWidth={1.5}
                            className="shrink-0 group-open:rotate-180 motion-safe:transition-transform"
                            aria-hidden="true"
                        />
                    </summary>
                    <fieldset disabled={busy} className="min-w-0 space-y-5 p-3 pt-2">
                        <legend className="sr-only">{t('activeRoast.recovery.editDetails')}</legend>
                        <label className="block space-y-2 text-sm font-medium leading-[1.5] text-primary">
                            <span>{t('activeRoast.recovery.bean')}</span>
                            <FormSelect
                                className="text-base focus-visible:outline-2 focus-visible:outline-secondary sm:text-sm"
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
                        <div className="grid gap-4 @min-[360px]:grid-cols-2">
                            <label className="block space-y-2 text-sm font-medium leading-[1.5] text-primary">
                                <span>{t('activeRoast.recovery.inputWeight')}</span>
                                <input
                                    className={`${inputCls} text-base sm:text-sm`}
                                    name="inputWeight"
                                    inputMode="decimal"
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
                            <label className="block space-y-2 text-sm font-medium leading-[1.5] text-primary">
                                <span>{t('activeRoast.recovery.outputWeight')}</span>
                                <input
                                    className={`${inputCls} text-base sm:text-sm`}
                                    name="outputWeight"
                                    inputMode="decimal"
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
                        </div>
                        <div className="space-y-3">
                            <p className="text-xs leading-[1.5] text-secondary">
                                {t('activeRoast.recovery.scheduleHelp')}
                            </p>
                            <div className="grid gap-4 @min-[360px]:grid-cols-2">
                                <label className="block space-y-2 text-sm font-medium leading-[1.5] text-primary">
                                    <span>{t('activeRoast.recovery.scheduleDate')}</span>
                                    <input
                                        className={`${inputCls} min-w-0 text-base sm:text-sm`}
                                        name="scheduleDate"
                                        type="date"
                                        value={date}
                                        onChange={(e) => setDate(e.target.value)}
                                    />
                                </label>
                                <label className="block space-y-2 text-sm font-medium leading-[1.5] text-primary">
                                    <span>{t('activeRoast.recovery.batch')}</span>
                                    <FormSelect
                                        className="text-base focus-visible:outline-2 focus-visible:outline-secondary sm:text-sm"
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
                            </div>
                        </div>
                    </fieldset>
                </details>
            )}
            <div className="flex flex-col gap-3 @min-[360px]:flex-row @min-[360px]:flex-wrap">
                {onReview && (
                    <SurfaceButton
                        disabled={busy}
                        onClick={onReview}
                        className="h-auto min-h-10 max-w-full whitespace-normal text-center focus-visible:outline-secondary"
                    >
                        {t('activeRoast.recovery.review')}
                    </SurfaceButton>
                )}
                <PillButton
                    type="button"
                    disabled={busy || !pending.params.sessionId}
                    onClick={() => void run()}
                    className="h-auto min-h-10 max-w-full whitespace-normal text-center focus-visible:outline-secondary"
                >
                    {t(
                        pending.db === 'saved'
                            ? 'activeRoast.recovery.syncAction'
                            : pending.submitted
                              ? 'activeRoast.recovery.retry'
                              : 'activeRoast.recovery.saveAction',
                    )}
                </PillButton>
                {!onReview && (
                    <SurfaceButton
                        type="button"
                        disabled={busy}
                        onClick={onRequestDiscard}
                        className="h-auto min-h-10 max-w-full whitespace-normal bg-main-bg text-center text-(--color-phase-danger) hover:bg-main-bg focus-visible:outline-secondary @min-[360px]:ms-auto"
                    >
                        {t('activeRoast.recovery.discard')}
                    </SurfaceButton>
                )}
            </div>
        </section>
    );
};
