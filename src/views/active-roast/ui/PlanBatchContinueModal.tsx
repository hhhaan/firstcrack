import { formatRoastSaveError } from '@features/active-roast/lib/saveErrorClassification';
import type { PlanBatchWithProgress } from '@shared/types/database.types';
import { ModalShell } from '@shared/ui/modal-shell/ModalShell';
import { modalPanel } from '@shared/ui/modal-shell/modalPanel';
import { type FC, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

interface PlanBatchContinueModalProps {
    show: boolean;
    candidates: PlanBatchWithProgress[];
    onStartNext: (row: PlanBatchWithProgress) => Promise<void>;
    onDismiss: () => void;
    onGoToSchedule?: () => void;
}

export const PlanBatchContinueModal: FC<PlanBatchContinueModalProps> = ({
    show,
    candidates,
    onStartNext,
    onDismiss,
    onGoToSchedule,
}) => {
    const { t } = useTranslation();
    const [busy, setBusy] = useState(false);
    const inFlight = useRef(false);
    const [error, setError] = useState<string | null>(null);
    const start = async (row: PlanBatchWithProgress) => {
        if (inFlight.current) return;
        inFlight.current = true;
        setBusy(true);
        setError(null);
        try {
            await onStartNext(row);
        } catch (err) {
            setError(formatRoastSaveError(err));
        } finally {
            inFlight.current = false;
            setBusy(false);
        }
    };
    const [selectedId, setSelectedId] = useState<string | null>(null);

    useEffect(() => {
        if (show && candidates.length > 0) {
            setSelectedId(candidates[0].id);
        }
        if (!show) setSelectedId(null);
    }, [show, candidates]);

    if (!show || candidates.length === 0) return null;

    const selected = candidates.find((c) => c.id === selectedId) ?? candidates[0];
    const isSingleSameBatch = candidates.length === 1;
    const sessionsLeft = selected.completed_sessions < selected.batch_count;

    return (
        <ModalShell
            onClose={() => {
                if (!inFlight.current) onDismiss();
            }}
            labelledBy="plan-batch-continue-title"
            overlayClassName="z-[10000]"
            contentClassName={modalPanel.sm}
            data-testid="plan-batch-continue-modal"
        >
            {error && (
                <p role="alert" className="mb-2 text-sm text-red-500">
                    {error}
                </p>
            )}
            <h2
                id="plan-batch-continue-title"
                className="text-[18px] font-semibold leading-tight text-primary tracking-[-0.3px] mb-1.5"
            >
                {t('activeRoast.planBatch.title')}
            </h2>
            <p className="text-[13px] text-secondary leading-[1.5] mb-4">
                {isSingleSameBatch && sessionsLeft
                    ? t('activeRoast.planBatch.sessionsComplete', {
                          done: selected.completed_sessions,
                          total: selected.batch_count,
                      })
                    : t('activeRoast.planBatch.remainingBatches', { count: candidates.length })}
            </p>

            <div className="flex flex-col gap-2 mb-5 max-h-[240px] overflow-y-auto">
                {candidates.map((batch, index) => {
                    const active = batch.id === selected.id;
                    return (
                        <button
                            key={batch.id}
                            type="button"
                            disabled={busy}
                            data-testid={`plan-batch-candidate-${batch.id}`}
                            onClick={() => setSelectedId(batch.id)}
                            className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-left border transition-colors cursor-pointer ${
                                active
                                    ? 'bg-palette-purple/8 border-palette-purple/15'
                                    : 'bg-surface border-transparent shadow-(--shadow-inset) hover:bg-surface-raised'
                            }`}
                        >
                            <div
                                className={`w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 ${
                                    active
                                        ? 'bg-palette-blue text-white'
                                        : 'bg-palette-lavender/15 text-palette-lavender'
                                }`}
                            >
                                {index + 1}
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="text-[13px] font-medium text-primary truncate">{batch.bean_name}</p>
                                <p className="text-[11px] text-muted">
                                    {batch.batch_size_kg != null
                                        ? t('activeRoast.planBatch.kgPerBatch', { kg: batch.batch_size_kg })
                                        : null}
                                    {' · '}
                                    {t('activeRoast.summary.sessionProgress', {
                                        current: batch.completed_sessions,
                                        total: batch.batch_count,
                                    })}
                                </p>
                            </div>
                            {active && (
                                <span className="text-[11px] font-semibold text-palette-purple shrink-0">
                                    {t('activeRoast.planBatch.nextLabel')}
                                </span>
                            )}
                        </button>
                    );
                })}
            </div>

            <div className="flex flex-col gap-2">
                <button
                    type="button"
                    disabled={busy}
                    data-testid="plan-batch-continue"
                    onClick={() => void start(selected)}
                    className="w-full py-3 rounded-full border-none bg-primary text-white text-[13px] font-semibold cursor-pointer tracking-[0.1px] hover:opacity-90 transition-opacity"
                >
                    {isSingleSameBatch ? t('activeRoast.planBatch.nextSession') : t('activeRoast.planBatch.nextBatch')}
                </button>
                <button
                    type="button"
                    disabled={busy}
                    data-testid="plan-batch-done"
                    onClick={onDismiss}
                    className="w-full py-2.5 rounded-full border-none bg-surface text-secondary text-[13px] font-medium cursor-pointer shadow-(--shadow-inset) hover:bg-surface-raised transition-colors"
                >
                    {t('activeRoast.planBatch.doneForToday')}
                </button>
                {onGoToSchedule && (
                    <button
                        type="button"
                        disabled={busy}
                        data-testid="plan-batch-schedule"
                        onClick={onGoToSchedule}
                        className="w-full py-2 text-[12px] font-medium text-muted cursor-pointer bg-transparent border-none hover:text-secondary transition-colors"
                    >
                        {t('activeRoast.planBatch.backToSchedule')}
                    </button>
                )}
            </div>
        </ModalShell>
    );
};
