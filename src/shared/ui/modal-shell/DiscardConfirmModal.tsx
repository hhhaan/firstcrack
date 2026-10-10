import { ModalShell } from '@shared/ui/modal-shell/ModalShell';
import { modalPanel } from '@shared/ui/modal-shell/modalPanel';

export type DiscardConfirmModalProps = {
    open: boolean;
    titleId: string;
    title: string;
    message: string;
    cancelLabel: string;
    confirmLabel: string;
    onCancel: () => void;
    onConfirm: () => void;
    error?: string;
    modalTestId?: string;
    cancelTestId?: string;
    confirmTestId?: string;
    actionsClassName?: string;
    titleClassName?: string;
    contentClassName?: string;
    cancelButtonClassName?: string;
    confirmButtonClassName?: string;
};

export const DiscardConfirmModal = ({
    open,
    titleId,
    title,
    message,
    cancelLabel,
    confirmLabel,
    onCancel,
    onConfirm,
    error,
    modalTestId,
    cancelTestId,
    confirmTestId,
    actionsClassName = 'flex gap-2',
    titleClassName = 'mb-4 text-lg font-semibold',
    contentClassName = modalPanel.sm,
    cancelButtonClassName = 'rounded bg-surface px-3 py-2 text-sm',
    confirmButtonClassName = 'rounded px-3 py-2 text-sm text-red-500',
}: DiscardConfirmModalProps) => {
    if (!open) return null;
    return (
        <ModalShell
            onClose={onCancel}
            labelledBy={titleId}
            data-testid={modalTestId}
            overlayClassName="z-[10001]"
            contentClassName={contentClassName}
        >
            <h2 id={titleId} className={titleClassName}>
                {title}
            </h2>
            <p className="mb-4 text-sm text-muted">{message}</p>
            {error ? (
                <p role="alert" className="mb-4 text-sm text-red-500">
                    {error}
                </p>
            ) : null}
            <div className={actionsClassName}>
                <button type="button" data-testid={cancelTestId} onClick={onCancel} className={cancelButtonClassName}>
                    {cancelLabel}
                </button>
                <button
                    type="button"
                    data-testid={confirmTestId}
                    onClick={onConfirm}
                    className={confirmButtonClassName}
                >
                    {confirmLabel}
                </button>
            </div>
        </ModalShell>
    );
};
