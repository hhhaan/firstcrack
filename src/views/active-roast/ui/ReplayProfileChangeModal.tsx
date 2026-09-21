import { ModalShell } from '@shared/ui/modal-shell/ModalShell';
import { modalPanel } from '@shared/ui/modal-shell/modalPanel';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

interface Props {
    open: boolean;
    onCancel: () => void;
    onConfirm: () => void;
}

/**
 * Replay On인 채 타겟 프로파일을 바꿀 때. 확인 전에는 Replay를 끄지 않는다 (#529 D).
 * Overlay/Escape = 취소. 확인 = 중단 후 변경. 자동 재시작 없음.
 */
export const ReplayProfileChangeModal = ({ open, onCancel, onConfirm }: Props) => {
    const { t } = useTranslation();
    const confirmRef = useRef<HTMLButtonElement>(null);
    const cancelRef = useRef<HTMLButtonElement>(null);
    const previousFocusRef = useRef<HTMLElement | null>(null);

    useEffect(() => {
        if (!open) return;
        previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        confirmRef.current?.focus();
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                onCancel();
            } else if (event.key === 'Tab') {
                event.preventDefault();
                (document.activeElement === confirmRef.current ? cancelRef : confirmRef).current?.focus();
            }
        };
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('keydown', onKey);
            previousFocusRef.current?.focus?.();
        };
    }, [open, onCancel]);

    if (!open) return null;

    return (
        <ModalShell
            onClose={onCancel}
            labelledBy="replay-profile-change-title"
            overlayClassName="z-[10000]"
            contentClassName={modalPanel.sm}
            data-testid="replay-profile-change-modal"
        >
            <h2
                id="replay-profile-change-title"
                className="text-[18px] font-semibold text-primary tracking-[-0.2px] mb-2"
            >
                {t('activeRoast.replay.profileChange.title')}
            </h2>
            <p className="text-sm text-secondary leading-[1.6] mb-5.5">
                {t('activeRoast.replay.profileChange.message')}
            </p>
            <div className="grid grid-cols-2 gap-2">
                <button
                    ref={cancelRef}
                    type="button"
                    onClick={onCancel}
                    className="w-full py-3 rounded-lg bg-surface text-secondary text-sm cursor-pointer tracking-[0.14px] dark:border dark:border-border"
                >
                    {t('activeRoast.replay.profileChange.cancel')}
                </button>
                <button
                    ref={confirmRef}
                    type="button"
                    data-testid="replay-profile-change-confirm"
                    onClick={onConfirm}
                    className="w-full py-3 rounded-lg border-none bg-phase-danger-bg text-phase-danger text-sm cursor-pointer tracking-[0.14px]"
                >
                    {t('activeRoast.replay.profileChange.confirm')}
                </button>
            </div>
        </ModalShell>
    );
};
