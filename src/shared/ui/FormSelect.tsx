import { cn } from '@shared/lib/cn';
import { selectCls } from '@shared/ui/form-styles';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@shared/ui/select/Select';
import {
    type ChangeEvent,
    Children,
    type FocusEventHandler,
    forwardRef,
    isValidElement,
    type ReactNode,
    type SelectHTMLAttributes,
    useState,
} from 'react';

/** Radix rejects `value=""`. Map the blank option through this and emit `""` to callers. */
const EMPTY = '\u0000';

type FormSelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children' | 'onChange'> & {
    /** Outer wrapper (relative container for the trigger). */
    wrapperClassName?: string;
    children?: ReactNode;
    onChange?: (event: ChangeEvent<HTMLSelectElement>) => void;
};

type MenuItem = { value: string; label: string; disabled: boolean };
type MenuBlock = { label?: string; items: MenuItem[] };

const textOf = (node: ReactNode): string => {
    if (node == null || typeof node === 'boolean') return '';
    if (typeof node === 'string' || typeof node === 'number') return String(node);
    if (Array.isArray(node)) return node.map(textOf).join('');
    if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
    return '';
};

const readOption = (node: ReactNode): MenuItem | null => {
    if (!isValidElement<{ value?: string | number; disabled?: boolean; children?: ReactNode }>(node)) return null;
    if (node.type !== 'option') return null;
    const label = textOf(node.props.children);
    const value = node.props.value == null ? label : String(node.props.value);
    return { value, label: label || value, disabled: Boolean(node.props.disabled) };
};

const menuBlocks = (children: ReactNode): MenuBlock[] => {
    const blocks: MenuBlock[] = [];
    const push = (item: MenuItem, label?: string) => {
        const last = blocks[blocks.length - 1];
        if (last && last.label === label) last.items.push(item);
        else blocks.push({ ...(label ? { label } : {}), items: [item] });
    };
    Children.forEach(children, (child) => {
        if (!isValidElement<{ label?: string; children?: ReactNode }>(child)) return;
        if (child.type === 'optgroup') {
            const label = child.props.label ? String(child.props.label) : undefined;
            Children.forEach(child.props.children, (option) => {
                const item = readOption(option);
                if (item) push(item, label);
            });
            return;
        }
        const item = readOption(child);
        if (item) push(item);
    });
    return blocks;
};

const changeEvent = (value: string, name?: string): ChangeEvent<HTMLSelectElement> => {
    const target = { value, name: name ?? '' };
    return { target, currentTarget: target } as ChangeEvent<HTMLSelectElement>;
};

const triggerAttrs = (props: Record<string, unknown>) => {
    const attrs: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(props)) {
        if (
            key.startsWith('aria-') ||
            key.startsWith('data-') ||
            key === 'id' ||
            key === 'title' ||
            key === 'autoFocus'
        )
            attrs[key] = val;
    }
    return attrs;
};

export const FormSelect = forwardRef<HTMLButtonElement, FormSelectProps>(
    (
        { className, wrapperClassName, children, value, defaultValue, onChange, onBlur, name, disabled, ...props },
        ref,
    ) => {
        const blocks = menuBlocks(children);
        const items = blocks.flatMap((block) => block.items);
        const placeholder = items.find((item) => item.disabled && item.value === '')?.label;
        const [uncontrolled, setUncontrolled] = useState(defaultValue == null ? '' : String(defaultValue));
        const current = value == null ? uncontrolled : String(value);
        const radixValue = current === '' ? EMPTY : current;
        const known = items.some((item) => !item.disabled && (item.value === '' ? EMPTY : item.value) === radixValue);
        const choose = (next: string) => {
            const real = next === EMPTY ? '' : next;
            if (value == null) setUncontrolled(real);
            onChange?.(changeEvent(real, name));
        };
        const searchKeywords = blocks
            .flatMap((block) => [...(block.label ? [block.label] : []), ...block.items.map((item) => item.label)])
            .join(' ');

        return (
            <div
                className={cn('relative min-w-0 w-full', wrapperClassName)}
                {...(searchKeywords ? { 'data-form-select-keywords': searchKeywords } : {})}
            >
                <Select value={known ? radixValue : ''} onValueChange={choose} disabled={disabled}>
                    <SelectTrigger
                        ref={ref}
                        onBlur={onBlur as FocusEventHandler<HTMLButtonElement> | undefined}
                        data-value={current}
                        className={cn(selectCls, 'w-full px-3', className)}
                        {...triggerAttrs(props)}
                    >
                        <SelectValue placeholder={placeholder} />
                    </SelectTrigger>
                    <SelectContent className="z-[10060] max-h-72">
                        {blocks.map((block) => {
                            const rows = block.items.filter((item) => !(item.disabled && item.value === ''));
                            if (!rows.length) return null;
                            const options = rows.map((item, index) => (
                                <SelectItem
                                    key={`${block.label ?? 'item'}:${item.value}:${index}`}
                                    value={item.value === '' ? EMPTY : item.value}
                                    disabled={item.disabled}
                                    data-value={item.value}
                                >
                                    {item.label}
                                </SelectItem>
                            ));
                            if (!block.label) return options;
                            return (
                                <SelectGroup key={block.label}>
                                    <div className="px-2 pt-2 pb-0.5 text-[11px] tracking-[0.04em] text-muted">
                                        {block.label}
                                    </div>
                                    {options}
                                </SelectGroup>
                            );
                        })}
                    </SelectContent>
                </Select>
            </div>
        );
    },
);
FormSelect.displayName = 'FormSelect';
