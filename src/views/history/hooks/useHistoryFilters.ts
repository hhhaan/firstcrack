import type { SessionFilterCriteria } from '@shared/lib/sessionFilter';
import { type DatePreset, getPresetYMRange } from '@widgets/date-range-filter';
import { useCallback, useMemo, useReducer } from 'react';
import type { SortKey } from '../ui/HistoryTable';

// ── State ──

interface HistoryFilterState {
    search: string;
    levelFilter: string;
    originFilter: string;
    datePreset: DatePreset;
    fromYM: string;
    toYM: string;
    page: number;
    sortKey: SortKey;
    sortAsc: boolean;
}

// ── Actions ──

type Action =
    | { type: 'SET_SEARCH'; value: string }
    | { type: 'SET_LEVEL_FILTER'; value: string }
    | { type: 'SET_ORIGIN_FILTER'; value: string }
    | { type: 'SET_DATE_PRESET'; value: DatePreset }
    | { type: 'SET_FROM_YM'; value: string }
    | { type: 'SET_TO_YM'; value: string }
    | { type: 'SET_SORT'; key: SortKey }
    | { type: 'SET_PAGE'; value: number };

// ── Initial State ──

const INITIAL: HistoryFilterState = {
    search: '',
    levelFilter: 'all',
    originFilter: 'all',
    datePreset: 'all',
    fromYM: '',
    toYM: '',
    page: 1,
    sortKey: 'date',
    sortAsc: false,
};

// ── Reducer ──

const filterReducer = (state: HistoryFilterState, action: Action): HistoryFilterState => {
    switch (action.type) {
        case 'SET_SEARCH':
            return { ...state, search: action.value, page: 1 };
        case 'SET_LEVEL_FILTER':
            return { ...state, levelFilter: action.value, page: 1 };
        case 'SET_ORIGIN_FILTER':
            return { ...state, originFilter: action.value, page: 1 };
        case 'SET_DATE_PRESET': {
            if (action.value === 'all') {
                return { ...state, datePreset: 'all', fromYM: '', toYM: '', page: 1 };
            }
            if (action.value === 'custom') {
                return { ...state, datePreset: 'custom', page: 1 };
            }
            const range = getPresetYMRange(action.value);
            return {
                ...state,
                datePreset: action.value,
                fromYM: range?.fromYM ?? '',
                toYM: range?.toYM ?? '',
                page: 1,
            };
        }
        case 'SET_FROM_YM':
            return { ...state, fromYM: action.value, page: 1 };
        case 'SET_TO_YM':
            return { ...state, toYM: action.value, page: 1 };
        case 'SET_SORT': {
            const sameKey = state.sortKey === action.key;
            return {
                ...state,
                sortKey: action.key,
                sortAsc: sameKey ? !state.sortAsc : false,
                page: 1,
            };
        }
        case 'SET_PAGE':
            return { ...state, page: action.value };
        default:
            return state;
    }
};

// ── Hook ──

export const useHistoryFilters = () => {
    const [state, dispatch] = useReducer(filterReducer, INITIAL);

    const { search, levelFilter, originFilter, datePreset, fromYM, toYM, page, sortKey, sortAsc } = state;

    const filterCriteria: SessionFilterCriteria = useMemo(
        () => ({ search, levelFilter, fromYM, toYM, originFilter }),
        [search, levelFilter, fromYM, toYM, originFilter],
    );

    const setSearch = useCallback((value: string) => dispatch({ type: 'SET_SEARCH', value }), []);
    const setLevelFilter = useCallback((value: string) => dispatch({ type: 'SET_LEVEL_FILTER', value }), []);
    const setOriginFilter = useCallback((value: string) => dispatch({ type: 'SET_ORIGIN_FILTER', value }), []);
    const setDatePreset = useCallback((value: DatePreset) => dispatch({ type: 'SET_DATE_PRESET', value }), []);
    const setFromYM = useCallback((value: string) => dispatch({ type: 'SET_FROM_YM', value }), []);
    const setToYM = useCallback((value: string) => dispatch({ type: 'SET_TO_YM', value }), []);
    const setSort = useCallback((key: SortKey) => dispatch({ type: 'SET_SORT', key }), []);
    const setPage = useCallback((value: number) => dispatch({ type: 'SET_PAGE', value }), []);

    return {
        search,
        levelFilter,
        originFilter,
        datePreset,
        fromYM,
        toYM,
        page,
        sortKey,
        sortAsc,
        filterCriteria,
        setSearch,
        setLevelFilter,
        setOriginFilter,
        setDatePreset,
        setFromYM,
        setToYM,
        setSort,
        setPage,
    };
};
