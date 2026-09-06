import { cn } from '@shared/lib/cn';
import { formErrorCls, inputCls, labelCls } from '@shared/ui/form-styles';
import {
    Children,
    cloneElement,
    createContext,
    isValidElement,
    type ReactElement,
    type ReactNode,
    useContext,
    useId,
    useMemo,
} from 'react';

type FormFieldContextValue = {
    id: string;
    error: string | null;
    disabled: boolean;
    required: boolean;
    descriptionId: string;
    errorId: string;
};

const FormFieldContext = createContext<FormFieldContextValue | null>(null);

const useFormField = () => {
    const ctx = useContext(FormFieldContext);
    if (!ctx) {
        throw new Error('FormField compound components must be used within FormField.Root');
    }
    return ctx;
};

type RootProps = {
    id?: string;
    error?: string | null;
    disabled?: boolean;
    required?: boolean;
    className?: string;
    children: ReactNode;
};

function Root({ id, error = null, disabled = false, required = false, className, children }: RootProps) {
    const autoId = useId();
    const fieldId = id ?? autoId;
    const value = useMemo<FormFieldContextValue>(
        () => ({
            id: fieldId,
            error: error ?? null,
            disabled,
            required,
            descriptionId: `${fieldId}-desc`,
            errorId: `${fieldId}-err`,
        }),
        [fieldId, error, disabled, required],
    );

    return (
        <FormFieldContext.Provider value={value}>
            <div className={className}>{children}</div>
        </FormFieldContext.Provider>
    );
}

function Label({ className, children }: { className?: string; children: ReactNode }) {
    const { id, required } = useFormField();
    return (
        <label htmlFor={id} className={cn(labelCls, className)}>
            {children}
            {required ? (
                <span aria-hidden className="text-red-500">
                    *
                </span>
            ) : null}
        </label>
    );
}

type ControlProps = {
    className?: string;
    children: ReactNode;
};

type ControlElementProps = {
    id?: string;
    className?: string;
    disabled?: boolean;
    'aria-invalid'?: boolean;
    'aria-describedby'?: string;
    'aria-required'?: boolean;
};

function Control({ className, children }: ControlProps) {
    const ctx = useFormField();
    const describedBy = [ctx.descriptionId, ctx.error ? ctx.errorId : null].filter(Boolean).join(' ') || undefined;

    return (
        <div className={cn('relative', className)}>
            {Children.map(children, (child) => {
                if (!isValidElement(child) || child.type === Unit || child.type === Addon) {
                    return child;
                }
                const el = child as ReactElement<ControlElementProps>;
                return cloneElement(el, {
                    id: el.props.id ?? ctx.id,
                    disabled: ctx.disabled || el.props.disabled,
                    'aria-invalid': ctx.error ? true : el.props['aria-invalid'],
                    'aria-describedby': describedBy ?? el.props['aria-describedby'],
                    'aria-required': ctx.required || undefined,
                    className: cn(typeof el.type === 'string' ? inputCls : undefined, el.props.className),
                });
            })}
        </div>
    );
}

function Unit({ className, children }: { className?: string; children: ReactNode }) {
    return (
        <span
            className={cn(
                'pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-[12px] font-medium text-muted',
                className,
            )}
        >
            {children}
        </span>
    );
}

function Addon({ className, children }: { className?: string; children: ReactNode }) {
    return (
        <span
            className={cn(
                'pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[12px] font-medium text-muted',
                className,
            )}
        >
            {children}
        </span>
    );
}

function Description({ className, children }: { className?: string; children: ReactNode }) {
    const { descriptionId } = useFormField();
    return (
        <p id={descriptionId} className={cn('mt-1 text-[11px] text-muted', className)}>
            {children}
        </p>
    );
}

function ErrorMessage({ className, children }: { className?: string; children?: ReactNode }) {
    const { error, errorId } = useFormField();
    const message = children ?? error;
    if (!message) return null;
    return (
        <p id={errorId} role="alert" className={cn(formErrorCls, className)}>
            {message}
        </p>
    );
}

export const FormField = {
    Root,
    Label,
    Control,
    Addon,
    Unit,
    Description,
    ErrorMessage,
};
