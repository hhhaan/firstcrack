import type { InputHTMLAttributes, ReactNode } from 'react';

const rowBase = 'flex min-w-0 gap-4 border-b border-border-subtle py-4 first:pt-0 last:border-b-0 last:pb-0';
const checkboxCls =
    'h-4 w-4 shrink-0 accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-40';
const switchCls =
    'relative h-5 w-9 shrink-0 cursor-pointer appearance-none rounded-full bg-primary/15 transition-colors checked:bg-primary before:absolute before:left-0.5 before:top-0.5 before:h-4 before:w-4 before:rounded-full before:bg-main-bg before:transition-transform checked:before:translate-x-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-40 forced-colors:appearance-auto';
const labelCls = 'text-sm text-primary';
const descCls = 'mt-0.5 text-xs leading-relaxed text-muted';

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
    type?: 'switch' | 'checkbox' | 'radio';
    checked: boolean;
    onChange: () => void;
    label: string;
    description?: string;
    name?: string;
    /** Right-aligned decoration (lock icon, plan badge, …) */
    trailing?: ReactNode;
} & Pick<InputHTMLAttributes<HTMLInputElement>, 'disabled'>;

/** Switches for preferences; native checkboxes and radios for selection. */
export function SettingsCheckRow({
    type = 'switch',
    checked,
    onChange,
    label,
    description,
    name,
    disabled,
    trailing,
}: SettingsCheckRowProps) {
    return (
        <SettingsOptionRow as="label" interactive className={type === 'radio' ? 'border-b-0 py-0!' : undefined}>
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
                type={type === 'switch' ? 'checkbox' : type}
                {...(type === 'switch' ? { role: 'switch', 'aria-checked': checked } : {})}
                name={name}
                checked={checked}
                disabled={disabled}
                onChange={onChange}
                className={type === 'switch' ? switchCls : `${checkboxCls} order-first`}
            />
        </SettingsOptionRow>
    );
}

export const settingsOptionLabelCls = labelCls;
export const settingsOptionDescCls = descCls;
export const settingsOptionSwitchCls = switchCls;
