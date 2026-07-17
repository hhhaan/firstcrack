import { ModalShell } from '@shared/ui/modal-shell/ModalShell';
import { modalPanel } from '@shared/ui/modal-shell/modalPanel';
import { Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface DeleteSessionModalProps {
    open: boolean;
    sessionName: string;
    isLoading?: boolean;
    onClose: () => void;
    onConfirm: () => void;
}

export const DeleteSessionModal = ({ open, sessionName, isLoading, onClose, onConfirm }: DeleteSessionModalProps) => {
    const { t } = useTranslation();

    if (!open) return null;

    return (
        <ModalShell
            onClose={onClose}
            labelledBy="delete-session-modal-title"
            overlayClassName="z-[10000]"
            contentClassName={modalPanel.sm}
        >
            <div className="w-11 h-11 rounded-[14px] bg-[rgba(254,226,226,0.9)] text-[#dc2626] flex items-center justify-center mb-4.5">
                <Trash2 size={18} strokeWidth={2} />
            </div>

            <h2
                id="delete-session-modal-title"
                className="font-(--font-mono) text-[28px] leading-[1.05] text-primary tracking-[-0.5px] mb-2.5"
            >
                {t('history.delete.title')}
            </h2>
            <p className="text-sm text-secondary leading-[1.6] mb-5.5">
                <span className="font-medium text-primary">{sessionName}</span> {t('history.delete.description')}
            </p>
            <div className="grid grid-cols-2 gap-2">
                <button
                    type="button"
                    disabled={isLoading}
                    onClick={onClose}
                    className="w-full py-3 rounded-lg border-none bg-surface text-secondary text-sm font-(--font-mono) cursor-pointer tracking-[0.14px] shadow-(--shadow-inset) disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    {t('history.delete.cancel')}
                </button>
                <button
                    type="button"
                    disabled={isLoading}
                    onClick={onConfirm}
                    className="w-full py-3 rounded-lg border-none bg-[rgba(254,226,226,0.8)] text-[#dc2626] text-sm font-(--font-mono) cursor-pointer tracking-[0.14px] shadow-(--shadow-card) disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    {isLoading ? `${t('history.delete.confirm')}…` : t('history.delete.confirm')}
                </button>
            </div>
        </ModalShell>
    );
};
