import { Check, ChevronDown } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { inputCls } from './form-styles';

export type BeanComboboxOption = { id: string; name: string };

type BeanComboboxProps = {
    id?: string;
    items: BeanComboboxOption[];
    selectedId: string;
    onSelect: (id: string) => void;
    /** Called when text does not match a selected inventory bean (also while typing). */
    onFreeText?: (name: string) => void;
    /** Called only when the typed value is committed (Enter/blur) — safe to persist from here. */
    onFreeTextCommit?: (name: string) => void;
    /** Initial display when no inventory bean is selected (e.g. a saved free-text label). */
    initialQuery?: string;
    placeholder?: string;
    disabled?: boolean;
    className?: string;
    emptyLabel?: string;
    compact?: boolean;
    /** aria-label for the dropdown chevron */
    listToggleLabel?: string;
    'data-testid'?: string;
};

/**
 * Inventory bean picker with free-text: type to filter, pick a row, or keep a custom name.
 * Exact name match commits as inventory id; otherwise onFreeText receives the label.
 */
export const BeanCombobox = ({
    id,
    items,
    selectedId,
    onSelect,
    onFreeText,
    onFreeTextCommit,
    initialQuery = '',
    placeholder = '',
    disabled = false,
    className = '',
    emptyLabel = '',
    compact = false,
    listToggleLabel = 'Toggle list',
    'data-testid': testId,
}: BeanComboboxProps) => {
    const listId = useId();
    const rootRef = useRef<HTMLDivElement>(null);
    const selected = items.find((i) => i.id === selectedId);
    const [query, setQuery] = useState(selected?.name ?? initialQuery);
    const [open, setOpen] = useState(false);
    const prevSelectedIdRef = useRef(selectedId);
    const itemsRef = useRef(items);

    useEffect(() => {
        itemsRef.current = items;
    }, [items]);

    // Sync display only when selectedId changes (not when items refetches).
    useEffect(() => {
        if (selectedId === prevSelectedIdRef.current) return;
        const previousId = prevSelectedIdRef.current;
        prevSelectedIdRef.current = selectedId;
        const name = itemsRef.current.find((i) => i.id === selectedId)?.name;
        if (name != null) {
            setQuery(name);
            return;
        }
        if (selectedId) return;
        // Clearing the link must not erase free text the operator is typing: only drop a leftover bean name.
        const previousName = itemsRef.current
            .find((i) => i.id === previousId)
            ?.name?.trim()
            .toLowerCase();
        setQuery((current) => (previousName && current.trim().toLowerCase() !== previousName ? current : initialQuery));
    }, [selectedId, initialQuery]);

    useEffect(() => {
        if (!open) return;
        const onDoc = (e: MouseEvent) => {
            if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener('mousedown', onDoc);
        return () => document.removeEventListener('mousedown', onDoc);
    }, [open]);

    const selectedName = selected?.name.trim().toLowerCase() ?? '';
    const matches = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q || q === selectedName) return items;
        return items.filter((i) => i.name.toLowerCase().includes(q));
    }, [items, query, selectedName]);
    // No match still lists every bean so the operator can pick one, but Enter must commit the text.
    const filtered = matches.length > 0 ? matches : items;

    const commitFreeOrMatch = (raw: string) => {
        const trimmed = raw.trim();
        if (!trimmed) {
            onSelect('');
            onFreeText?.('');
            onFreeTextCommit?.('');
            setQuery('');
            return;
        }
        const exact = items.find((i) => i.name.toLowerCase() === trimmed.toLowerCase());
        if (exact) {
            onSelect(exact.id);
            setQuery(exact.name);
            return;
        }
        onSelect('');
        onFreeText?.(trimmed);
        onFreeTextCommit?.(trimmed);
        setQuery(trimmed);
    };

    const inputClass = compact
        ? `${inputCls} appearance-none text-[13px] py-2 pr-8 ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`
        : `${inputCls} pr-9 ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`;

    return (
        <div ref={rootRef} className={`relative min-w-0 ${className}`} data-bean-combobox="" data-testid={testId}>
            <div className="relative">
                <input
                    id={id}
                    type="text"
                    role="combobox"
                    aria-expanded={open}
                    aria-controls={listId}
                    aria-autocomplete="list"
                    disabled={disabled}
                    className={inputClass}
                    placeholder={placeholder}
                    value={query}
                    maxLength={120}
                    autoComplete="off"
                    onFocus={() => !disabled && setOpen(true)}
                    onChange={(e) => {
                        const next = e.target.value;
                        setQuery(next);
                        setOpen(true);
                        if (selected && next.toLowerCase() !== selected.name.toLowerCase()) onSelect('');
                        if (!items.some((i) => i.name.toLowerCase() === next.toLowerCase())) onFreeText?.(next);
                    }}
                    onKeyDown={(e) => {
                        if (e.key === 'Escape') {
                            setOpen(false);
                            return;
                        }
                        if (e.key === 'Enter') {
                            // 한글 조합 확정 Enter는 선택/커밋으로 소비하지 않는다 (#317)
                            if (e.nativeEvent.isComposing) return;
                            e.preventDefault();
                            if (matches.length === 1) {
                                onSelect(matches[0].id);
                                setQuery(matches[0].name);
                                setOpen(false);
                            } else {
                                commitFreeOrMatch(query);
                                setOpen(false);
                            }
                        }
                    }}
                    onBlur={() => {
                        window.setTimeout(() => {
                            if (!rootRef.current?.contains(document.activeElement)) {
                                commitFreeOrMatch(query);
                                setOpen(false);
                            }
                        }, 120);
                    }}
                />
                <button
                    type="button"
                    tabIndex={-1}
                    disabled={disabled}
                    aria-label={listToggleLabel}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 border-none bg-transparent text-muted cursor-pointer disabled:cursor-not-allowed"
                    onMouseDown={(e) => {
                        e.preventDefault();
                        if (!disabled) setOpen((o) => !o);
                    }}
                >
                    <ChevronDown
                        size={compact ? 14 : 16}
                        strokeWidth={2}
                        className={`transition-transform ${open ? 'rotate-180' : ''}`}
                    />
                </button>
            </div>

            {open && !disabled && (
                <div
                    id={listId}
                    role="listbox"
                    className="absolute top-full left-0 right-0 mt-1.5 bg-white dark:bg-[#262b31] rounded-2xl border border-black/8 dark:border-[#585d61] shadow-[0_8px_24px_rgba(0,0,0,0.12)] z-50 overflow-hidden"
                >
                    <div className="max-h-[200px] overflow-y-auto py-1">
                        {filtered.length === 0 ? (
                            <div className="px-4 py-3 text-[13px] text-muted text-center">
                                {emptyLabel || (query.trim() ? query.trim() : '—')}
                            </div>
                        ) : (
                            filtered.map((item) => (
                                <button
                                    key={item.id}
                                    type="button"
                                    role="option"
                                    aria-selected={item.id === selectedId}
                                    className="w-full flex items-center justify-between px-4 py-2.5 text-left text-[13px] hover:bg-surface dark:hover:bg-surface-elevated cursor-pointer border-none bg-transparent transition-colors"
                                    onMouseDown={(e) => {
                                        e.preventDefault();
                                        onSelect(item.id);
                                        setQuery(item.name);
                                        setOpen(false);
                                    }}
                                >
                                    <span className="text-primary truncate">{item.name}</span>
                                    {item.id === selectedId && (
                                        <Check size={13} className="text-primary shrink-0 ml-2" strokeWidth={2.5} />
                                    )}
                                </button>
                            ))
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};
