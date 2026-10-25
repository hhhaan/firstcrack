import type { SessionFilterCriteria } from '@shared/lib/sessionFilter';
import { type DatePreset, getPresetYMRange } from '@widgets/date-range-filter';
import { useMemo, useState } from 'react';
import type { SortKey } from '../ui/HistoryTable';

interface HistoryFilterState {
    search: string;
    levelFilter: string;
    originFilter: string;
    profileFilter: string;
    datePreset: DatePreset;
    fromYM: string;
    toYM: string;
    page: number;
    sortKey: SortKey;
    sortAsc: boolean;
}

const INITIAL: HistoryFilterState = {
    search: '',
    levelFilter: 'all',
    originFilter: 'all',
    profileFilter: 'all',
    datePreset: 'all',
    fromYM: '',
    toYM: '',
    page: 1,
    sortKey: 'date',
    sortAsc: false,
};

export const useHistoryFilters = () => {
    const [state, setState] = useState<HistoryFilterState>(INITIAL);

    const { search, levelFilter, originFilter, profileFilter, datePreset, fromYM, toYM, page, sortKey, sortAsc } =
        state;

    const filterCriteria: SessionFilterCriteria = useMemo(
        () => ({ search, levelFilter, fromYM, toYM, originFilter, profileFilter }),
        [search, levelFilter, fromYM, toYM, originFilter, profileFilter],
    );

    const patch = (partial: Partial<HistoryFilterState>) => {
        setState((prev) => ({ ...prev, ...partial, page: 1 }));
    };

    return {
        search,
        levelFilter,
        originFilter,
        profileFilter,
        datePreset,
        fromYM,
        toYM,
        page,
        sortKey,
        sortAsc,
        filterCriteria,
        setSearch: (value: string) => patch({ search: value }),
        setLevelFilter: (value: string) => patch({ levelFilter: value }),
        setOriginFilter: (value: string) => patch({ originFilter: value }),
        setProfileFilter: (value: string) => patch({ profileFilter: value }),
        setDatePreset: (value: DatePreset) => {
            if (value === 'all') {
                setState((prev) => ({ ...prev, datePreset: 'all', fromYM: '', toYM: '', page: 1 }));
            } else if (value === 'custom') {
                setState((prev) => ({ ...prev, datePreset: 'custom', page: 1 }));
            } else {
                const range = getPresetYMRange(value);
                setState((prev) => ({
                    ...prev,
                    datePreset: value,
                    fromYM: range?.fromYM ?? '',
                    toYM: range?.toYM ?? '',
                    page: 1,
                }));
            }
        },
        setFromYM: (value: string) => patch({ fromYM: value }),
        setToYM: (value: string) => patch({ toYM: value }),
        setSort: (key: SortKey) => {
            setState((prev) => ({
                ...prev,
                sortKey: key,
                sortAsc: prev.sortKey === key ? !prev.sortAsc : false,
                page: 1,
            }));
        },
        setPage: (value: number) => setState((prev) => ({ ...prev, page: value })),
    };
};
