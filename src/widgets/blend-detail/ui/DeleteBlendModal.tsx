import { ModalShell } from '@shared/ui/modal-shell/ModalShell';
import { modalPanel } from '@shared/ui/modal-shell/modalPanel';
import { Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface DeleteBlendModalProps {
    open: boolean;
    blendName: string;
    onClose: () => void;
    onConfirm: () => void;
}

export const DeleteBlendModal = ({ open, blendName, onClose, onConfirm }: DeleteBlendModalProps) => {
    const { t } = useTranslation();
    if (!open) return null;

    return (
        <ModalShell
            onClose={onClose}
            labelledBy="delete-blend-modal-title"
            overlayClassName="z-[10000]"
            contentClassName={modalPanel.sm}
        >
            <div className="w-11 h-11 rounded-[14px] bg-[rgba(254,226,226,0.9)] text-[#dc2626] flex items-center justify-center mb-4.5">
                <Trash2 size={18} strokeWidth={2} />
            </div>

            <h2
                id="delete-blend-modal-title"
                className="font-(--font-mono) text-[28px] leading-[1.05] text-primary tracking-[-0.5px] mb-2.5"
            >
                {t('beans.blend.deleteConfirm.title')}
            </h2>
            <p className="text-sm text-secondary leading-[1.6] mb-5.5">
                {t('beans.blend.deleteConfirm.description', { name: blendName })}
            </p>

            <div className="grid grid-cols-2 gap-2">
                <button
                    type="button"
                    onClick={onClose}
                    className="w-full py-3 rounded-lg border-none bg-surface text-secondary text-sm font-(--font-mono) cursor-pointer tracking-[0.14px] shadow-(--shadow-inset)"
                >
                    {t('beans.blend.deleteConfirm.cancel')}
                </button>
                <button
                    type="button"
                    onClick={onConfirm}
                    className="w-full py-3 rounded-lg border-none bg-[rgba(254,226,226,0.8)] text-[#dc2626] text-sm font-(--font-mono) cursor-pointer tracking-[0.14px] shadow-(--shadow-card)"
                >
                    {t('beans.blend.deleteConfirm.confirm')}
                </button>
            </div>
        </ModalShell>
    );
};
