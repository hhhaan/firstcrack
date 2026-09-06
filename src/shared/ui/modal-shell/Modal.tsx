import { cn } from '@shared/lib/cn';
import { useFormEscape } from '@shared/lib/useFormEscape';
import { modalCancelBtnCls, modalFooterChrome, modalPrimaryBtnCls } from '@shared/ui/form-styles';
import { ModalFooter } from '@shared/ui/modal-shell/ModalFooter';
import { ModalHeader } from '@shared/ui/modal-shell/ModalHeader';
import { ModalScrollBody } from '@shared/ui/modal-shell/ModalScrollBody';
import { ModalShell } from '@shared/ui/modal-shell/ModalShell';
import { X } from 'lucide-react';
import {
    type ButtonHTMLAttributes,
    type ComponentProps,
    createContext,
    type ReactNode,
    useContext,
    useId,
} from 'react';

type ModalContextValue = {
    onClose: () => void;
    titleId: string;
};

const ModalContext = createContext<ModalContextValue | null>(null);

const useModal = () => {
    const ctx = useContext(ModalContext);
    if (!ctx) {
        throw new Error('Modal compound components must be used within Modal.Root');
    }
    return ctx;
};

type RootProps = Omit<ComponentProps<typeof ModalShell>, 'labelledBy'> & {
    open?: boolean;
    labelledBy?: string;
};

function Root({ open = true, onClose, labelledBy, children, ...shell }: RootProps) {
    const autoId = useId();
    const titleId = labelledBy ?? autoId;
    useFormEscape(open, onClose);
    if (!open) return null;
    return (
        <ModalContext.Provider value={{ onClose, titleId }}>
            <ModalShell onClose={onClose} labelledBy={titleId} {...shell}>
                {children}
            </ModalShell>
        </ModalContext.Provider>
    );
}

type HeaderProps = Omit<ComponentProps<typeof ModalHeader>, 'titleId' | 'onClose'> & {
    titleId?: string;
    onClose?: () => void;
};

function Header(props: HeaderProps) {
    const ctx = useModal();
    return <ModalHeader {...props} titleId={props.titleId ?? ctx.titleId} onClose={props.onClose ?? ctx.onClose} />;
}

function Title({ className, children }: { className?: string; children: ReactNode }) {
    const { titleId } = useModal();
    return (
        <h2
            id={titleId}
            className={cn('m-0 font-(--font-display) text-2xl tracking-[-0.02em] text-primary', className)}
        >
            {children}
        </h2>
    );
}

const defaultCloseCls =
    'w-9 h-9 rounded-xl border-none bg-surface dark:bg-surface-elevated text-muted flex items-center justify-center cursor-pointer transition-all hover:text-primary shrink-0';

function Close({ className, label = 'Close' }: { className?: string; label?: string }) {
    const { onClose } = useModal();
    return (
        <button type="button" onClick={onClose} aria-label={label} className={cn(defaultCloseCls, className)}>
            <X size={18} strokeWidth={2.3} />
        </button>
    );
}

function Body(props: ComponentProps<typeof ModalScrollBody>) {
    return <ModalScrollBody {...props} />;
}

type FooterSlots = {
    children: ReactNode;
    className?: string;
    cancelLabel?: never;
    primaryLabel?: never;
};

type FooterActions = Omit<ComponentProps<typeof ModalFooter>, 'onCancel'> & {
    onCancel?: () => void;
    children?: undefined;
};

function isFooterSlots(props: FooterSlots | FooterActions): props is FooterSlots {
    return props.children != null;
}

function Footer(props: FooterSlots | FooterActions) {
    const ctx = useModal();
    if (isFooterSlots(props)) {
        return (
            <div className={cn(modalFooterChrome, props.className)}>
                <div className="flex gap-3">{props.children}</div>
            </div>
        );
    }
    const { onCancel, ...rest } = props;
    return <ModalFooter onCancel={onCancel ?? ctx.onClose} {...rest} />;
}

function Cancel({ className, children, onClick, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
    const { onClose } = useModal();
    return (
        <button type="button" onClick={onClick ?? onClose} className={cn(modalCancelBtnCls, className)} {...props}>
            {children}
        </button>
    );
}

function Action({ className, type = 'button', ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
    return <button type={type} className={cn(modalPrimaryBtnCls, className)} {...props} />;
}

export const Modal = {
    Root,
    Header,
    Title,
    Close,
    Body,
    Footer,
    Action,
    Cancel,
};
