import type { StockSummary } from '@entities/bean-stock-event';
import type { Bean } from '@shared/types/database.types';

export type BeanModalTab = 'new' | 'restock' | 'edit' | 'adjust';

export type BeanPickerProps = {
    visibleBeans: Bean[];
    selectedBeanId: string | null;
    showAllBeans: boolean;
    hiddenBeanCount: number;
    stockSummaries: Record<string, StockSummary>;
    onSelect: (id: string) => void;
    onShowAll: () => void;
};

export const BEAN_LIST_LIMIT = 4;
