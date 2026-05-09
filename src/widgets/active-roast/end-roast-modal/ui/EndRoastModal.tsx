import { Square } from 'lucide-react';
import { ModalShell } from '@shared/ui/modal-shell/ModalShell';

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
            contentStyle={{
                width: 'min(420px, 100%)',
                background: 'var(--color-main-bg)',
                borderRadius: 20,
                padding: '28px',
                boxShadow: 'rgba(0,0,0,0.22) 0px 24px 64px, rgba(0,0,0,0.06) 0px 0px 0px 1px',
            }}
        >
            <div
                style={{
                    width: 44,
                    height: 44,
                    borderRadius: 14,
                    background: 'rgba(254,226,226,0.9)',
                    color: '#dc2626',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginBottom: 18,
                }}
            >
                <Square size={18} strokeWidth={2} />
            </div>

            <h2
                id="end-roast-modal-title"
                style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 28,
                    fontWeight: 400,
                    lineHeight: 1.05,
                    color: 'var(--color-primary)',
                    letterSpacing: '-0.5px',
                    marginBottom: 10,
                }}
            >
                로스트를 종료할까요?
            </h2>
            <p style={{ fontSize: 14, color: 'var(--color-secondary)', lineHeight: 1.6, marginBottom: 22 }}>
                타이머가 {timeStr}에서 멈추고 로스트가 종료됩니다.
            </p>
            <div className="grid grid-cols-2 gap-2">
                <button
                    onClick={onClose}
                    className="w-full py-3 rounded-lg border-none bg-surface text-secondary text-sm font-(--font-mono) cursor-pointer tracking-[0.14px] shadow-(--shadow-inset)"
                >
                    아니오
                </button>
                <button
                    onClick={onConfirm}
                    className="w-full py-3 rounded-lg border-none bg-[rgba(254,226,226,0.8)] text-[#dc2626] text-sm font-cursor-pointer tracking-[0.14px] shadow-(--shadow-card)"
                >
                    예
                </button>
            </div>
        </ModalShell>
    );
};
