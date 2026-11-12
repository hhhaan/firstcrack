import { ModalShell } from '@shared/ui/modal-shell/ModalShell';
import { modalPanel } from '@shared/ui/modal-shell/modalPanel';
import { Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';

export type DangerDeleteConfirmModalProps = {
    open: boolean;
    titleId: string;
    title: string;
    description: string;
    cancelLabel: string;
    confirmLabel: string;
    /** Shown on the confirm button while `isLoading` (defaults to `confirmLabel`). */
    pendingLabel?: string;
    isLoading?: boolean;
    error?: string | null;
    warning?: ReactNode;
    onClose: () => void;
    onConfirm: () => void;
    'data-testid'?: string;
    confirmButtonTestId?: string;
};

export const DangerDeleteConfirmModal = ({
    open,
    titleId,
    title,
    description,
    cancelLabel,
    confirmLabel,
    pendingLabel,
    isLoading,
    error,
    warning,
    onClose,
    onConfirm,
    'data-testid': dataTestId,
    confirmButtonTestId,
}: DangerDeleteConfirmModalProps) => {
    if (!open) return null;

    const confirmText = isLoading ? (pendingLabel ?? confirmLabel) : confirmLabel;

    return (
        <ModalShell
            onClose={onClose}
            labelledBy={titleId}
            overlayClassName="z-[10000]"
            contentClassName={modalPanel.sm}
            data-testid={dataTestId}
        >
            <div className="mb-4.5 flex h-11 w-11 items-center justify-center rounded-[14px] bg-(--color-phase-danger-bg) text-(--color-phase-danger)">
                <Trash2 size={18} strokeWidth={2} />
            </div>
            <h2
                id={titleId}
                className="mb-2.5 font-(--font-mono) text-[28px] leading-[1.05] tracking-[-0.5px] text-primary"
            >
                {title}
            </h2>
            <p className="mb-5.5 text-sm leading-[1.6] text-secondary">{description}</p>
            {warning}
            {error ? (
                <p role="alert" className="mb-4 text-[13px] leading-[1.5] text-(--color-phase-danger)">
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
                    {cancelLabel}
                </button>
                <button
                    type="button"
                    disabled={isLoading}
                    data-testid={confirmButtonTestId}
                    onClick={onConfirm}
                    className="w-full cursor-pointer rounded-lg border-none bg-phase-danger-bg py-3 font-(--font-mono) text-sm tracking-[0.14px] text-phase-danger shadow-(--shadow-card) disabled:cursor-not-allowed disabled:opacity-50"
                >
                    {confirmText}
                </button>
            </div>
        </ModalShell>
    );
};
