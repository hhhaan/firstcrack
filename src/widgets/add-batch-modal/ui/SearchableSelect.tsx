import { useState, useEffect } from 'react';
import { Check } from 'lucide-react';

const inputCls =
    'w-full px-3.5 py-2.5 rounded-xl border border-black/8 bg-white/80 shadow-(--shadow-inset) text-sm text-primary outline-none transition-all focus:border-black/20';

export const SearchableSelect = ({
    placeholder,
    items,
    selectedId,
    onSelect,
    renderLabel,
    renderOption,
}: {
    placeholder: string;
    items: { id: string }[];
    selectedId: string;
    onSelect: (id: string) => void;
    renderLabel: (item: { id: string }) => string;
    renderOption?: (item: { id: string }) => React.ReactNode;
}) => {
    const [query, setQuery] = useState('');
    const [open, setOpen] = useState(false);

    const selected = items.find((i) => i.id === selectedId);
    const filtered = items.filter((i) =>
        renderLabel(i).toLowerCase().includes(query.toLowerCase()),
    );

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
    }, [open]);

    return (
        <div className="relative" data-searchable-select="">
            <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                className={`${inputCls} text-left flex items-center justify-between gap-2`}
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
                    <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
            </button>

            {open && (
                <div className="absolute top-full left-0 right-0 mt-1.5 bg-white rounded-2xl border border-black/8 shadow-[0_8px_24px_rgba(0,0,0,0.12)] z-50 overflow-hidden">
                    <div className="p-2 border-b border-black/4">
                        <input
                            autoFocus
                            className="w-full px-3 py-2 rounded-xl border border-black/8 bg-surface text-sm text-primary outline-none"
                            placeholder="검색..."
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                        />
                    </div>
                    <div className="max-h-[200px] overflow-y-auto py-1">
                        {filtered.length === 0 ? (
                            <div className="px-4 py-3 text-[13px] text-muted text-center">결과 없음</div>
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
                                    {renderOption ? renderOption(item) : (
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
                                onClick={() => { onSelect(''); setOpen(false); }}
                                className="w-full px-3 py-2 text-[12px] text-muted text-center rounded-xl border-none hover:bg-surface cursor-pointer transition-colors"
                            >
                                선택 해제
                            </button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};
