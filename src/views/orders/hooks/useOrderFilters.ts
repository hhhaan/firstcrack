import type { OrderStatusFilter } from '@entities/order';
import { type DatePreset, getPresetYMRange } from '@widgets/date-range-filter';
import { useState } from 'react';

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
        setPage: (value: number) => setState((prev) => ({ ...prev, page: value })),
    };
};
