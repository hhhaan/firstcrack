import { useState } from 'react';

export const ChipGroup = ({
    items,
    renderItem,
    limit = 5,
}: {
    items: readonly string[];
    renderItem: (item: string) => React.ReactNode;
    limit?: number;
}) => {
    const [expanded, setExpanded] = useState(false);
    const visible = !expanded && items.length > limit ? items.slice(0, limit) : items;
    const hiddenCount = items.length - limit;
    return (
        <>
            {visible.map(renderItem)}
            {!expanded && hiddenCount > 0 && (
                <button
                    type="button"
                    onClick={() => setExpanded(true)}
                    className="px-2.5 py-1 rounded-full text-xs font-medium cursor-pointer border border-black/10 dark:border-[#585d61] bg-white/70 dark:bg-surface-elevated text-muted"
                >
                    +{hiddenCount}
                </button>
            )}
        </>
    );
};
