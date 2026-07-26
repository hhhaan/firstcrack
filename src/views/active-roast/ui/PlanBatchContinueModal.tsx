import type { PlanBatchHandoff } from '@shared/types/database.types';
import { ModalShell } from '@shared/ui/modal-shell/ModalShell';
import { modalPanel } from '@shared/ui/modal-shell/modalPanel';
import { type FC, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

interface PlanBatchContinueModalProps {
    show: boolean;
    candidates: PlanBatchHandoff[];
    onStartNext: (handoff: PlanBatchHandoff) => void;
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
    const [selectedId, setSelectedId] = useState<string | null>(null);

    useEffect(() => {
        if (show && candidates.length > 0) {
            setSelectedId(candidates[0].planBatchId);
        }
        if (!show) setSelectedId(null);
    }, [show, candidates]);

    if (!show || candidates.length === 0) return null;

    const selected = candidates.find((c) => c.planBatchId === selectedId) ?? candidates[0];
    const isSingleSameBatch = candidates.length === 1;
    const sessionsLeft = selected.completedSessions < selected.batchCount;

    return (
        <ModalShell
            onClose={onDismiss}
            labelledBy="plan-batch-continue-title"
            overlayClassName="z-[10000]"
            contentClassName={modalPanel.sm}
            data-testid="plan-batch-continue-modal"
        >
            <h2
                id="plan-batch-continue-title"
                className="text-[18px] font-semibold leading-tight text-primary tracking-[-0.3px] mb-1.5"
            >
                {t('activeRoast.planBatch.title')}
            </h2>
            <p className="text-[13px] text-secondary leading-[1.5] mb-4">
                {isSingleSameBatch && sessionsLeft
                    ? t('activeRoast.planBatch.sessionsComplete', {
                          done: selected.completedSessions,
                          total: selected.batchCount,
                      })
                    : t('activeRoast.planBatch.remainingBatches', { count: candidates.length })}
            </p>

            <div className="flex flex-col gap-2 mb-5 max-h-[240px] overflow-y-auto">
                {candidates.map((batch, index) => {
                    const active = batch.planBatchId === selected.planBatchId;
                    return (
                        <button
                            key={batch.planBatchId}
                            type="button"
                            data-testid={`plan-batch-candidate-${batch.planBatchId}`}
                            onClick={() => setSelectedId(batch.planBatchId)}
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
                                <p className="text-[13px] font-medium text-primary truncate">{batch.beanName}</p>
                                <p className="text-[11px] text-muted">
                                    {batch.batchSizeKg != null
                                        ? t('activeRoast.planBatch.kgPerBatch', { kg: batch.batchSizeKg })
                                        : null}
                                    {' · '}
                                    {t('activeRoast.summary.sessionProgress', {
                                        current: batch.completedSessions,
                                        total: batch.batchCount,
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
                    data-testid="plan-batch-continue"
                    onClick={() => onStartNext(selected)}
                    className="w-full py-3 rounded-full border-none bg-primary text-white text-[13px] font-semibold cursor-pointer tracking-[0.1px] hover:opacity-90 transition-opacity"
                >
                    {isSingleSameBatch ? t('activeRoast.planBatch.nextSession') : t('activeRoast.planBatch.nextBatch')}
                </button>
                <button
                    type="button"
                    data-testid="plan-batch-done"
                    onClick={onDismiss}
                    className="w-full py-2.5 rounded-full border-none bg-surface text-secondary text-[13px] font-medium cursor-pointer shadow-(--shadow-inset) hover:bg-surface-raised transition-colors"
                >
                    {t('activeRoast.planBatch.doneForToday')}
                </button>
                {onGoToSchedule && (
                    <button
                        type="button"
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
