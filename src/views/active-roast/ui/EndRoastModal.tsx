import { cn } from '@shared/lib/cn';
import { ModalHeader } from '@shared/ui/modal-shell/ModalHeader';
import { ModalShell } from '@shared/ui/modal-shell/ModalShell';
import { modalPanel } from '@shared/ui/modal-shell/modalPanel';
import { useTranslation } from 'react-i18next';

interface EndRoastModalProps {
    open: boolean;
    timeStr: string;
    onClose: () => void;
    onConfirm: () => void;
}

export const EndRoastModal = ({ open, timeStr, onClose, onConfirm }: EndRoastModalProps) => {
    const { t } = useTranslation();

    if (!open) {
        return null;
    }

    return (
        <ModalShell
            onClose={onClose}
            labelledBy="end-roast-modal-title"
            overlayClassName="z-[10000]"
            contentClassName={cn(modalPanel.sm, 'p-5')}
        >
            <ModalHeader
                title={t('activeRoast.endRoastModal.title')}
                titleId="end-roast-modal-title"
                onClose={onClose}
                closeLabel={t('common.close')}
                className="mb-2"
                titleClassName="m-0 text-xl font-semibold leading-7 tracking-tight text-primary"
                closeClassName="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md border-none bg-transparent text-muted transition-colors hover:bg-surface hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            />
            <p className="mb-4 text-sm leading-6 text-muted">
                {t('activeRoast.endRoastModal.description', { time: timeStr })}
            </p>
            <div className="flex justify-end gap-3">
                <button
                    type="button"
                    onClick={onClose}
                    className="h-8 min-w-18 cursor-pointer rounded-lg border border-border bg-main-bg px-4 text-sm text-primary transition-colors duration-100 hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                >
                    {t('activeRoast.endRoastModal.cancel')}
                </button>
                <button
                    type="button"
                    data-testid="end-roast-confirm"
                    onClick={onConfirm}
                    className="h-8 min-w-18 cursor-pointer rounded-lg border-none bg-(--color-phase-danger-bg) px-4 text-sm text-(--color-phase-danger) transition-colors duration-100 hover:bg-(--color-phase-danger)/15 active:bg-(--color-phase-danger)/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                >
                    {t('activeRoast.endRoastModal.confirm')}
                </button>
            </div>
        </ModalShell>
    );
};
