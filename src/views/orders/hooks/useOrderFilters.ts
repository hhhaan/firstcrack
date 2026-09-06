import type { OrderStatusFilter } from '@entities/order';
import { type DatePreset, getPresetYMRange } from '@widgets/date-range-filter';
import { useCallback, useState } from 'react';

/** Clamp a 1-based page so a shrink in `total` cannot leave the UI on an empty page. */
export const clampPage = (page: number, total: number, pageSize: number): number => {
    const totalPages = Math.max(1, Math.ceil(Math.max(0, total) / pageSize));
    return Math.min(Math.max(1, page), totalPages);
};

interface OrderFilterState {
    search: string;
    status: OrderStatusFilter;
    platform: string;
    datePreset: DatePreset;
    fromYM: string;
    toYM: string;
    page: number;
}

const INITIAL: OrderFilterState = {
    search: '',
    status: 'all',
    platform: 'all',
    datePreset: 'all',
    fromYM: '',
    toYM: '',
    page: 1,
};

/** Mirrors useHistoryFilters — every filter change resets to page 1, only setPage does not. */
export const useOrderFilters = () => {
    const [state, setState] = useState<OrderFilterState>(INITIAL);

    const patch = (partial: Partial<OrderFilterState>) => setState((prev) => ({ ...prev, ...partial, page: 1 }));
    const setPage = useCallback((value: number) => setState((prev) => ({ ...prev, page: value })), []);

    return {
        ...state,
        isFiltered:
            state.search !== '' || state.status !== 'all' || state.platform !== 'all' || state.datePreset !== 'all',
        setSearch: (value: string) => patch({ search: value }),
        setStatus: (value: OrderStatusFilter) => patch({ status: value }),
        setPlatform: (value: string) => patch({ platform: value }),
        setDatePreset: (value: DatePreset) => {
            const range = value === 'all' || value === 'custom' ? null : getPresetYMRange(value);
            patch({
                datePreset: value,
                ...(value === 'all' ? { fromYM: '', toYM: '' } : {}),
                ...(range ? { fromYM: range.fromYM, toYM: range.toYM } : {}),
            });
        },
        setFromYM: (value: string) => patch({ fromYM: value }),
        setToYM: (value: string) => patch({ toYM: value }),
        reset: () => setState(INITIAL),
        setPage,
    };
};
