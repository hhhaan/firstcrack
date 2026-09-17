import { ModalShell } from '@shared/ui/modal-shell/ModalShell';
import { modalPanel } from '@shared/ui/modal-shell/modalPanel';
import { Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

type DeleteCuppingEventModalProps = {
    open: boolean;
    sessionTitle: string;
    isLoading?: boolean;
    error?: string | null;
    onClose: () => void;
    onConfirm: () => void;
};

export const DeleteCuppingEventModal = ({
    open,
    sessionTitle,
    isLoading,
    error,
    onClose,
    onConfirm,
}: DeleteCuppingEventModalProps) => {
    const { t } = useTranslation();
    if (!open) return null;

    return (
        <ModalShell
            onClose={onClose}
            labelledBy="cupping-delete-event-title"
            overlayClassName="z-[10000]"
            contentClassName={modalPanel.sm}
            data-testid="cupping-delete-event-modal"
        >
            <div className="mb-4.5 flex h-11 w-11 items-center justify-center rounded-[14px] bg-[rgba(254,226,226,0.9)] text-[#dc2626]">
                <Trash2 size={18} strokeWidth={2} />
            </div>
            <h2
                id="cupping-delete-event-title"
                className="mb-2.5 font-(--font-mono) text-[28px] leading-[1.05] tracking-[-0.5px] text-primary"
            >
                {t('cupping.deleteEvent')}
            </h2>
            <p className="mb-5.5 text-sm leading-[1.6] text-secondary">
                {t('cupping.deleteEventConfirm', { name: sessionTitle })}
            </p>
            {error ? (
                <p role="alert" className="mb-4 text-[13px] leading-[1.5] text-[#dc2626]">
                    {error}
                </p>
            ) : null}
            <div className="grid grid-cols-2 gap-2">
                <button
                    type="button"
                    disabled={isLoading}
                    onClick={onClose}
                    className="w-full cursor-pointer rounded-lg border-none bg-surface py-3 font-(--font-mono) text-sm tracking-[0.14px] text-secondary shadow-(--shadow-inset) disabled:cursor-not-allowed disabled:opacity-50"
                >
                    {t('cupping.cancel')}
                </button>
                <button
                    type="button"
                    disabled={isLoading}
                    data-testid="cupping-delete-confirm"
                    onClick={onConfirm}
                    className="w-full cursor-pointer rounded-lg border-none bg-[rgba(254,226,226,0.8)] py-3 font-(--font-mono) text-sm tracking-[0.14px] text-[#dc2626] shadow-(--shadow-card) disabled:cursor-not-allowed disabled:opacity-50"
                >
                    {isLoading ? t('cupping.deletingEvent') : t('cupping.deleteEvent')}
                </button>
            </div>
        </ModalShell>
    );
};
