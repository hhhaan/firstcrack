import { cn } from '@shared/lib/cn';
import { modalCancelBtnCls, modalFooterChrome, modalPrimaryBtnCls } from '@shared/ui/form-styles';
import type { ReactNode } from 'react';

type ModalFooterProps = {
    onCancel: () => void;
    cancelLabel: ReactNode;
    primaryLabel: ReactNode;
    onPrimary?: () => void;
    primaryDisabled?: boolean;
    primaryType?: 'button' | 'submit';
    primaryForm?: string;
    primaryClassName?: string;
    primaryTestId?: string;
    className?: string;
};

/**
 * Sticky footer chrome + cancel/primary actions. Put extra width/weight on `primaryClassName`.
 */
export function ModalFooter({
    onCancel,
    cancelLabel,
    primaryLabel,
    onPrimary,
    primaryDisabled = false,
    primaryType = 'button',
    primaryForm,
    primaryClassName,
    primaryTestId,
    className,
}: ModalFooterProps) {
    return (
        <div className={cn(modalFooterChrome, className)}>
            <div className="flex gap-3">
                <button type="button" onClick={onCancel} className={modalCancelBtnCls}>
                    {cancelLabel}
                </button>
                <button
                    type={primaryType}
                    form={primaryForm}
                    onClick={onPrimary}
                    disabled={primaryDisabled}
                    data-testid={primaryTestId}
                    className={cn(modalPrimaryBtnCls, primaryClassName)}
                >
                    {primaryLabel}
                </button>
            </div>
        </div>
    );
}
