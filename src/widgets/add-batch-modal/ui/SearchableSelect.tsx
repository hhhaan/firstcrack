import { cn } from '@shared/lib/cn';
import { inputCls } from '@shared/ui/form-styles';
import { Check } from 'lucide-react';
import {
    createContext,
    type Dispatch,
    type ReactNode,
    type SetStateAction,
    useCallback,
    useContext,
    useEffect,
    useState,
} from 'react';
import { useTranslation } from 'react-i18next';

const SelectMenuContext = createContext<{
    active: string | null;
    setActive: Dispatch<SetStateAction<string | null>>;
} | null>(null);

export const SelectMenuGroup = ({ children }: { children: ReactNode }) => {
    const [active, setActive] = useState<string | null>(null);
    return <SelectMenuContext.Provider value={{ active, setActive }}>{children}</SelectMenuContext.Provider>;
};

export const useSelectMenu = (id?: string) => {
    const menu = useContext(SelectMenuContext);
    const setActive = menu?.setActive;
    const onOpenChange = useCallback(
        (next: boolean) => {
            if (!id || !setActive) return;
            setActive((current) => (next ? id : current === id ? null : current));
        },
        [id, setActive],
    );
    if (!id || !menu) return null;
    return { open: menu.active === id, onOpenChange };
};

export const SearchableSelect = ({
    placeholder,
    items,
    selectedId,
    onSelect,
    renderLabel,
    renderOption,
    menuId,
    invalid = false,
}: {
    placeholder: string;
    items: { id: string }[];
    selectedId: string;
    onSelect: (id: string) => void;
    renderLabel: (item: { id: string }) => string;
    renderOption?: (item: { id: string }) => React.ReactNode;
    menuId?: string;
    invalid?: boolean;
}) => {
    const { t } = useTranslation();
    const menu = useSelectMenu(menuId);
    const [query, setQuery] = useState('');
    const [ownOpen, setOwnOpen] = useState(false);
    const open = menu?.open ?? ownOpen;
    const onOpenChange = menu?.onOpenChange;
    const setOpen = useCallback(
        (next: boolean) => {
            if (onOpenChange) onOpenChange(next);
            else setOwnOpen(next);
        },
        [onOpenChange],
    );

    const selected = items.find((i) => i.id === selectedId);
    const filtered = items.filter((i) => renderLabel(i).toLowerCase().includes(query.toLowerCase()));

    useEffect(() => {
        if (!open) setQuery('');
    }, [open]);

    useEffect(() => {
        if (!open) return;
        const fn = (e: MouseEvent) => {
            if (!(e.target as Element).closest('[data-searchable-select]')) setOpen(false);
        };
        document.addEventListener('mousedown', fn);
        return () => document.removeEventListener('mousedown', fn);
    }, [open, setOpen]);

    return (
        <div className="relative" data-searchable-select="">
            <button
                type="button"
                onClick={() => setOpen(!open)}
                aria-invalid={invalid || undefined}
                className={cn(
                    inputCls,
                    'text-left flex items-center justify-between gap-2',
                    invalid && 'border-red-500',
                )}
            >
                <span className={selected ? 'text-primary' : 'text-muted'}>
                    {selected ? renderLabel(selected) : placeholder}
                </span>
                <svg
                    width="12"
                    height="12"
                    viewBox="0 0 12 12"
                    fill="none"
                    className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
                >
                    <path
                        d="M2 4l4 4 4-4"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    />
                </svg>
            </button>

            {open && (
                <div className="absolute top-full left-0 right-0 mt-1.5 bg-white dark:bg-surface-elevated rounded-2xl border border-black/8 dark:border-border shadow-[0_8px_24px_rgba(0,0,0,0.12)] z-50 overflow-hidden">
                    <div className="p-2 border-b border-black/4">
                        <input
                            autoFocus
                            className="w-full px-3 py-2 rounded-xl border border-black/8 dark:border-border bg-surface dark:bg-surface-elevated text-sm text-primary outline-none"
                            placeholder={t('addBatchModal.searchPlaceholder')}
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                        />
                    </div>
                    <div className="max-h-[200px] overflow-y-auto py-1">
                        {filtered.length === 0 ? (
                            <div className="px-4 py-3 text-[13px] text-muted text-center">
                                {t('addBatchModal.noResults')}
                            </div>
                        ) : (
                            filtered.map((item) => (
                                <button
                                    key={item.id}
                                    type="button"
                                    onClick={() => {
                                        onSelect(item.id);
                                        setOpen(false);
                                    }}
                                    className="w-full flex items-center justify-between px-4 py-2.5 text-left text-[13px] hover:bg-surface cursor-pointer border-none bg-transparent transition-colors"
                                >
                                    {renderOption ? (
                                        renderOption(item)
                                    ) : (
                                        <span className="text-primary">{renderLabel(item)}</span>
                                    )}
                                    {item.id === selectedId && (
                                        <Check size={13} className="text-primary shrink-0 ml-2" strokeWidth={2.5} />
                                    )}
                                </button>
                            ))
                        )}
                    </div>
                    {selectedId && (
                        <div className="border-t border-black/4 p-2">
                            <button
                                type="button"
                                onClick={() => {
                                    onSelect('');
                                    setOpen(false);
                                }}
                                className="w-full px-3 py-2 text-[12px] text-muted text-center rounded-xl border-none hover:bg-surface cursor-pointer transition-colors"
                            >
                                {t('addBatchModal.clearSelection')}
                            </button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};
