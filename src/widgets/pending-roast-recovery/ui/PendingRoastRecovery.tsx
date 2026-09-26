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
import { useSaveRoast } from '@features/active-roast/model/useSaveRoast';
import { useUploadRoastProfile } from '@features/upload-roast-profile';
import { inputCls } from '@shared/ui/form-styles';
import { ModalShell } from '@shared/ui/modal-shell/ModalShell';
import { modalPanel } from '@shared/ui/modal-shell/modalPanel';
import { format } from 'date-fns';
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
export const PendingRoastRecovery = () => {
    const { t } = useTranslation();
    const { workspaceOwnerId, isWorkspaceReady } = useActiveWorkspace();
    const [state, setState] = useState(load);
    const [open, setOpen] = useState(false);
    const [discardTarget, setDiscardTarget] = useState<PendingRoastSave | null>(null);
    const [discardError, setDiscardError] = useState('');
    const { mutateAsync: syncRoastCurve } = useUploadRoastProfile();
    const { resumeSave } = useSaveRoast(null, syncRoastCurve);
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
            void resumeSave(pending)
                .catch(() => {})
                .finally(refresh);
        }
    }, [state.items, isWorkspaceReady, workspaceOwnerId, resumeSave, refresh]);
    const items = state.items.filter((p) => p.params.userId === workspaceOwnerId);
    if (!state.error && items.length === 0) return null;
    return (
        <>
            <button
                type="button"
                onClick={() => setOpen(true)}
                className="fixed bottom-4 right-4 z-50 rounded-xl bg-surface px-4 py-2 text-sm text-primary shadow-lg"
            >
                {t('activeRoast.recovery.pending', { count: items.length })}
            </button>
            {open && (
                <ModalShell
                    onClose={() => setOpen(false)}
                    labelledBy="pending-roasts-title"
                    overlayClassName="z-[10000]"
                    contentClassName={modalPanel.sm}
                >
                    <h2 id="pending-roasts-title" className="mb-4 text-lg font-semibold">
                        {t('activeRoast.recovery.title')}
                    </h2>
                    {state.error && <p role="alert">{state.error}</p>}
                    <div className="max-h-[70vh] space-y-4 overflow-auto">
                        {items.map((pending) => (
                            <RecoveryItem
                                key={`${pending.params.userId}:${pending.params.sessionId}`}
                                pending={pending}
                                retry={resumeSave}
                                refresh={refresh}
                                onRequestDiscard={() => {
                                    if (isPendingRoastSaveActive(pending.params.userId, pending.params.sessionId))
                                        return;
                                    setDiscardError('');
                                    setDiscardTarget(pending);
                                }}
                            />
                        ))}
                    </div>
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
                        <button type="button" onClick={closeDiscard} className="rounded bg-surface px-3 py-2 text-sm">
                            {t('common.cancel')}
                        </button>
                        <button
                            type="button"
                            data-testid="pending-roast-discard-confirm"
                            onClick={confirmDiscard}
                            className="rounded px-3 py-2 text-sm text-red-500"
                        >
                            {t('activeRoast.recovery.discard')}
                        </button>
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
}: {
    pending: PendingRoastSave;
    retry: (p: PendingRoastSave) => Promise<unknown>;
    refresh: () => void;
    onRequestDiscard: () => void;
}) => {
    const { t } = useTranslation();
    const [draft, setDraft] = useState(pending);
    const [working, setBusy] = useState(false);
    const busy = working || isPendingRoastSaveActive(pending.params.userId, pending.params.sessionId);
    const running = useRef(false);
    const [error, setError] = useState('');
    const [date, setDate] = useState(() => format(new Date(), 'yyyy-MM-dd'));
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
        <section className="space-y-2 rounded-lg border border-border-subtle p-3">
            <p className="text-sm font-medium">
                {pending.params.handoffBeanName ?? pending.params.formData.beanLabel ?? t('activeRoast.recovery.title')}
            </p>
            <p className="text-xs text-muted">
                {pending.db === 'saved' ? t('activeRoast.recovery.syncPending') : t('activeRoast.recovery.failed')}
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
                <fieldset disabled={busy} className="space-y-2">
                    <label className="block text-sm">
                        {t('activeRoast.recovery.bean')}
                        <select
                            className={inputCls}
                            value={form.beanId ?? ''}
                            onChange={(e) => updateForm({ beanId: e.target.value || null })}
                        >
                            <option value="">{t('activeRoast.recovery.noBean')}</option>
                            {beans.map((bean) => (
                                <option key={bean.id} value={bean.id}>
                                    {bean.name}
                                </option>
                            ))}
                        </select>
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
                        <select
                            className={inputCls}
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
                        </select>
                    </label>
                </fieldset>
            )}
            <div className="flex gap-2">
                <button
                    type="button"
                    disabled={busy || !pending.params.sessionId}
                    onClick={() => void run()}
                    className="rounded bg-surface px-3 py-2 text-sm"
                >
                    {t('activeRoast.recovery.retry')}
                </button>
                <button
                    type="button"
                    disabled={busy}
                    onClick={onRequestDiscard}
                    className="rounded px-3 py-2 text-sm text-red-500"
                >
                    {t('activeRoast.recovery.discard')}
                </button>
            </div>
        </section>
    );
};
