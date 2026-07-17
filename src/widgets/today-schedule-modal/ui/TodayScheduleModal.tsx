import type { PlanBatchHandoff } from '@shared/types/database.types';
import { ModalShell } from '@shared/ui/modal-shell/ModalShell';
import { modalPanel } from '@shared/ui/modal-shell/modalPanel';

interface TodayScheduleModalProps {
    open: boolean;
    batches: PlanBatchHandoff[];
    onStart: (batch: PlanBatchHandoff) => void;
    onSkip: () => void;
}

export const TodayScheduleModal = ({ open, batches, onStart, onSkip }: TodayScheduleModalProps) => {
    if (!open || batches.length === 0) return null;

    const firstBatch = batches[0];

    return (
        <ModalShell
            onClose={onSkip}
            labelledBy="today-schedule-modal-title"
            overlayClassName="z-[10000]"
            contentClassName={modalPanel.sm}
        >
            <div className="w-11 h-11 rounded-xl bg-[rgba(219,234,254,0.9)] text-[#2563eb] flex items-center justify-center mb-4.5">
                <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                >
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                    <line x1="16" y1="2" x2="16" y2="6" />
                    <line x1="8" y1="2" x2="8" y2="6" />
                    <line x1="3" y1="10" x2="21" y2="10" />
                </svg>
            </div>

            <h2
                id="today-schedule-modal-title"
                className="text-[22px] font-semibold leading-[1.1] text-primary tracking-[-0.4px] mb-1.5"
            >
                오늘의 로스팅 일정
            </h2>
            <p className="text-sm text-secondary leading-[1.6] mb-5">{batches.length}개 배치가 예정되어 있습니다.</p>

            <div className="flex flex-col gap-2 mb-6">
                {batches.map((batch, index) => (
                    <div
                        key={batch.planBatchId}
                        className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl ${
                            index === 0
                                ? 'bg-palette-purple/8 border border-palette-purple/15'
                                : 'bg-surface shadow-(--shadow-inset)'
                        }`}
                    >
                        <div
                            className={`w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 ${
                                index === 0
                                    ? 'bg-palette-blue text-white'
                                    : 'bg-palette-lavender/15 text-palette-lavender'
                            }`}
                        >
                            {index + 1}
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="text-[13px] font-medium text-primary truncate">{batch.beanName}</p>
                            <p className="text-[11px] text-muted">{batch.batchSizeKg}kg / 배치</p>
                        </div>
                        {index === 0 && (
                            <span className="text-[11px] font-semibold text-palette-purple shrink-0">다음</span>
                        )}
                    </div>
                ))}
            </div>

            <div className="flex flex-col gap-2">
                <button
                    type="button"
                    onClick={() => onStart(firstBatch)}
                    className="w-full py-3 rounded-xl border-none bg-primary text-white text-[13px] font-semibold cursor-pointer tracking-[0.1px] hover:opacity-90 transition-opacity"
                >
                    일정대로 시작
                </button>
                <button
                    type="button"
                    onClick={onSkip}
                    className="w-full py-2.5 rounded-xl border-none bg-surface text-secondary text-[13px] font-medium cursor-pointer shadow-(--shadow-inset) hover:bg-surface-raised transition-colors"
                >
                    일정 없이 시작
                </button>
            </div>
        </ModalShell>
    );
};
