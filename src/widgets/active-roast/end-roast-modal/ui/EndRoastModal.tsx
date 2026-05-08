import { useState } from 'react';
import { Square } from 'lucide-react';
import { ModalShell } from '../../../../shared/ui/modal-shell/ModalShell';

interface EndRoastModalProps {
    open: boolean;
    timeStr: string;
    onClose: () => void;
    onDiscard: () => void;
    onConfirm: () => void;
}

export const EndRoastModal = ({ open, timeStr, onClose, onDiscard, onConfirm }: EndRoastModalProps) => {
    const [step, setStep] = useState<'confirm' | 'save'>('confirm');

    if (!open) {
        return null;
    }

    const handleClose = () => {
        setStep('confirm');
        onClose();
    };

    const handleDiscard = () => {
        setStep('confirm');
        onDiscard();
    };

    const handleConfirm = () => {
        setStep('confirm');
        onConfirm();
    };

    return (
        <ModalShell
            onClose={handleClose}
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

            {step === 'confirm' ? (
                <>
                    <h2
                        id="end-roast-modal-title"
                        style={{
                            fontFamily: 'var(--font-display)',
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
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                        <button
                            onClick={handleClose}
                            style={{
                                padding: '12px 0',
                                borderRadius: 9999,
                                border: 'none',
                                background: 'var(--color-surface)',
                                color: 'var(--color-secondary)',
                                fontSize: 14,
                                fontWeight: 500,
                                cursor: 'pointer',
                                boxShadow: 'var(--shadow-inset)',
                            }}
                        >
                            아니오
                        </button>
                        <button
                            onClick={() => setStep('save')}
                            style={{
                                padding: '12px 0',
                                borderRadius: 9999,
                                border: 'none',
                                background: 'rgba(254,226,226,0.8)',
                                color: '#dc2626',
                                fontSize: 14,
                                fontWeight: 500,
                                cursor: 'pointer',
                                boxShadow: 'var(--shadow-card)',
                            }}
                        >
                            예
                        </button>
                    </div>
                </>
            ) : (
                <>
                    <h2
                        id="end-roast-modal-title"
                        style={{
                            fontFamily: 'var(--font-display)',
                            fontSize: 28,
                            fontWeight: 400,
                            lineHeight: 1.05,
                            color: 'var(--color-primary)',
                            letterSpacing: '-0.5px',
                            marginBottom: 10,
                        }}
                    >
                        저장할까요?
                    </h2>
                    <p style={{ fontSize: 14, color: 'var(--color-secondary)', lineHeight: 1.6, marginBottom: 22 }}>
                        로스트 로그와 요약을 저장하거나, 저장 없이 종료할 수 있습니다.
                    </p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <button
                            onClick={handleConfirm}
                            style={{
                                padding: '12px 0',
                                borderRadius: 9999,
                                border: 'none',
                                background: 'rgba(220,252,231,0.8)',
                                color: '#16a34a',
                                fontSize: 14,
                                fontWeight: 500,
                                cursor: 'pointer',
                                boxShadow: 'var(--shadow-card)',
                            }}
                        >
                            저장
                        </button>
                        <button
                            onClick={handleDiscard}
                            style={{
                                padding: '12px 0',
                                borderRadius: 9999,
                                border: 'none',
                                background: 'var(--color-surface)',
                                color: 'var(--color-secondary)',
                                fontSize: 14,
                                fontWeight: 500,
                                cursor: 'pointer',
                                boxShadow: 'var(--shadow-inset)',
                            }}
                        >
                            저장 안 함
                        </button>
                    </div>
                </>
            )}
        </ModalShell>
    );
};
