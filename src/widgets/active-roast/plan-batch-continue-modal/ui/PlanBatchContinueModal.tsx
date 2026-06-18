import type { FC } from 'react';

interface PlanBatchHandoff {
    beanName: string;
    batchCount: number;
    completedSessions: number;
    planBatchId: string;
    planId: string;
    beanId: string | null;
    profileId: string | null;
    batchSizeKg: number | null;
    blendId: string | null;
}

interface PlanBatchContinueModalProps {
    show: boolean;
    planBatchHandoff: PlanBatchHandoff | null;
    batchDone: boolean;
    sessionsAfter: number;
    onPlanBatchComplete?: () => void;
    onDismiss: () => void;
}

export const PlanBatchContinueModal: FC<PlanBatchContinueModalProps> = ({
    show,
    planBatchHandoff,
    batchDone,
    sessionsAfter,
    onPlanBatchComplete,
    onDismiss,
}) => {
    if (!show || !planBatchHandoff) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
            <div className="bg-white dark:bg-[#181d21] rounded shadow-[0_24px_64px_rgba(0,0,0,0.18)] border border-black/8 dark:border-[#585d61] p-8 w-[360px] flex flex-col gap-5">
                <div>
                    <p className="text-[15px] font-semibold text-primary">{planBatchHandoff.beanName}</p>
                    <p className="text-[13px] text-secondary mt-1">
                        {batchDone
                            ? `배치 완료 (${sessionsAfter}/${planBatchHandoff.batchCount})`
                            : `세션 ${sessionsAfter}/${planBatchHandoff.batchCount} 완료. 다음 세션을 진행할까요?`}
                    </p>
                </div>
                <div className="flex gap-2">
                    <button
                        onClick={() => {
                            onDismiss();
                            onPlanBatchComplete?.();
                        }}
                        className="flex-1 px-4 py-2.5 rounded-lg border border-border bg-surface text-secondary text-[13px] font-medium cursor-pointer hover:bg-surface-raised transition-colors"
                    >
                        {batchDone ? '일정으로 돌아가기' : '오늘은 여기까지'}
                    </button>
                    {!batchDone && (
                        <button
                            onClick={onDismiss}
                            className="flex-1 px-4 py-2.5 rounded-lg border-none bg-primary text-white text-[13px] font-semibold cursor-pointer hover:opacity-90 transition-opacity"
                        >
                            다음 세션 시작
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};
