import type { InputHTMLAttributes, ReactNode } from 'react';

const rowBase =
    'flex min-w-0 gap-3 py-3 border-b border-border-subtle first:pt-0 last:border-b-0 last:pb-0 in-[.settings-compact]:gap-2.5 in-[.settings-compact]:border-0 in-[.settings-compact]:py-2 in-[.settings-compact]:first:pt-2 in-[.settings-compact]:last:pb-2';
const checkboxCls = 'w-4 h-4 accent-primary shrink-0';
const switchCls =
    'relative h-6 w-10 shrink-0 cursor-pointer appearance-none rounded-full bg-primary/15 transition-colors checked:bg-primary before:absolute before:left-1 before:top-1 before:h-4 before:w-4 before:rounded-full before:bg-main-bg before:transition-transform checked:before:translate-x-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-40 forced-colors:appearance-auto';
const labelCls = 'text-[13px] font-medium text-primary';
const descCls = 'text-xs leading-relaxed text-secondary mt-0.5';

type SettingsOptionRowProps = {
    children: ReactNode;
    className?: string;
    /** `label` for clickable checkbox/radio rows */
    as?: 'div' | 'label';
    interactive?: boolean;
    /** trailing control layout */
    justify?: 'start' | 'between';
    align?: 'center' | 'start';
    /** muted fill (info rows) */
    tone?: 'default' | 'muted';
};

export function SettingsOptionRow({
    children,
    className = '',
    as = 'div',
    interactive = false,
    justify = 'start',
    align = 'center',
    tone = 'default',
}: SettingsOptionRowProps) {
    const Comp = as;
    const toneCls = tone === 'muted' ? 'text-muted' : '';
    const alignCls = align === 'start' ? 'items-start' : 'items-center';
    const layout = justify === 'between' ? `flex-col @[480px]:flex-row @[480px]:justify-between ${alignCls}` : alignCls;

    return (
        <Comp className={`${rowBase} ${toneCls} ${layout} ${interactive ? 'cursor-pointer' : ''} ${className}`.trim()}>
            {children}
        </Comp>
    );
}

type SettingsCheckRowProps = {
    type?: 'checkbox' | 'radio';
    checked: boolean;
    onChange: () => void;
    label: string;
    description?: string;
    name?: string;
    /** Right-aligned decoration (lock icon, plan badge, …) */
    trailing?: ReactNode;
} & Pick<InputHTMLAttributes<HTMLInputElement>, 'disabled'>;

/** Checkbox / radio option row used across settings sections. */
export function SettingsCheckRow({
    type = 'checkbox',
    checked,
    onChange,
    label,
    description,
    name,
    disabled,
    trailing,
}: SettingsCheckRowProps) {
    return (
        <SettingsOptionRow as="label" interactive>
            {description ? (
                <div className="min-w-0 flex-1">
                    <div className={labelCls}>{label}</div>
                    <div className={descCls}>{description}</div>
                </div>
            ) : (
                <span className={`${labelCls} min-w-0 flex-1`}>{label}</span>
            )}
            {trailing ? <span className="ml-auto flex items-center gap-1.5 shrink-0">{trailing}</span> : null}
            <input
                type={type}
                name={name}
                checked={checked}
                disabled={disabled}
                onChange={onChange}
                className={`${type === 'checkbox' ? switchCls : checkboxCls} in-[.settings-compact]:order-first in-[.settings-compact]:h-4 in-[.settings-compact]:w-4 in-[.settings-compact]:appearance-auto in-[.settings-compact]:accent-primary in-[.settings-compact]:before:hidden`}
            />
        </SettingsOptionRow>
    );
}

export const settingsOptionLabelCls = labelCls;
export const settingsOptionDescCls = descCls;
