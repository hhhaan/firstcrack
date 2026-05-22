import { Trash2 } from 'lucide-react';
import { ModalShell } from '@shared/ui/modal-shell/ModalShell';

interface DeleteBeanModalProps {
    open: boolean;
    beanName: string;
    onClose: () => void;
    onConfirm: () => void;
}

export const DeleteBeanModal = ({ open, beanName, onClose, onConfirm }: DeleteBeanModalProps) => {
    if (!open) return null;

    return (
        <ModalShell
            onClose={onClose}
            labelledBy="delete-bean-modal-title"
            overlayClassName="z-[10000]"
            contentClassName="max-w-[420px] w-full bg-main-bg rounded-[20px] p-7 shadow-[rgba(0,0,0,0.22)_0px_24px_64px,rgba(0,0,0,0.06)_0px_0px_0px_1px]"
        >
            <div className="w-11 h-11 rounded-[14px] bg-[rgba(254,226,226,0.9)] text-[#dc2626] flex items-center justify-center mb-4.5">
                <Trash2 size={18} strokeWidth={2} />
            </div>

            <h2
                id="delete-bean-modal-title"
                className="font-(--font-mono) text-[28px] leading-[1.05] text-primary tracking-[-0.5px] mb-2.5"
            >
                생두를 삭제할까요?
            </h2>
            <p className="text-sm text-secondary leading-[1.6] mb-5.5">
                <span className="font-medium text-primary">{beanName}</span>이(가) 영구적으로 삭제됩니다. 되돌릴 수
                없습니다.
            </p>
            <div className="grid grid-cols-2 gap-2">
                <button
                    onClick={onClose}
                    className="w-full py-3 rounded-lg border-none bg-surface text-secondary text-sm font-(--font-mono) cursor-pointer tracking-[0.14px] shadow-(--shadow-inset)"
                >
                    취소
                </button>
                <button
                    onClick={onConfirm}
                    className="w-full py-3 rounded-lg border-none bg-[rgba(254,226,226,0.8)] text-[#dc2626] text-sm font-(--font-mono) cursor-pointer tracking-[0.14px] shadow-(--shadow-card)"
                >
                    삭제
                </button>
            </div>
        </ModalShell>
    );
};
