import { ModalShell } from '@shared/ui/modal-shell/ModalShell';
import { modalPanel } from '@shared/ui/modal-shell/modalPanel';
import { Square } from 'lucide-react';

interface EndRoastModalProps {
    open: boolean;
    timeStr: string;
    onClose: () => void;
    onConfirm: () => void;
}

export const EndRoastModal = ({ open, timeStr, onClose, onConfirm }: EndRoastModalProps) => {
    if (!open) {
        return null;
    }

    return (
        <ModalShell
            onClose={onClose}
            labelledBy="end-roast-modal-title"
            overlayClassName="z-[10000]"
            contentClassName={modalPanel.sm}
        >
            <div className="w-11 h-11 rounded-md bg-[rgba(254,226,226,0.9)] dark:bg-[rgba(220,38,38,0.15)] text-[#dc2626] dark:text-[#f87171] flex items-center justify-center mb-4.5">
                <Square size={18} strokeWidth={2} />
            </div>

            <h2
                id="end-roast-modal-title"
                className="font-(--font-mono) text-[28px] leading-[1.05] text-primary tracking-[-0.5px] mb-2.5"
            >
                로스팅을 종료할까요?
            </h2>
            <p className="text-sm text-secondary leading-[1.6] mb-5.5">
                타이머가 {timeStr}에서 멈추고 로스트가 종료됩니다.
            </p>
            <div className="grid grid-cols-2 gap-2">
                <button
                    type="button"
                    onClick={onClose}
                    className="w-full py-3 rounded-lg bg-surface dark:bg-[#262B31] text-secondary text-sm font-(--font-mono) cursor-pointer tracking-[0.14px] dark:border dark:border-border"
                >
                    아니오
                </button>
                <button
                    type="button"
                    data-testid="end-roast-confirm"
                    onClick={onConfirm}
                    className="w-full py-3 rounded-lg border-none bg-[rgba(254,226,226,0.8)] dark:bg-[rgba(220,38,38,0.15)] text-[#dc2626] dark:text-[#f87171] text-sm font-(--font-mono) cursor-pointer tracking-[0.14px]"
                >
                    예
                </button>
            </div>
        </ModalShell>
    );
};
