import { describe, expect, it } from 'vitest';
import cuppingEventDetail from './views/cupping/ui/CuppingEventDetail.tsx?raw';
import cuppingEventList from './views/cupping/ui/CuppingEventList.tsx?raw';
import cuppingSampleSummary from './views/cupping/ui/CuppingSampleSummary.tsx?raw';
import channelsTab from './views/orders/ui/ChannelsTab.tsx?raw';
import ordersTab from './views/orders/ui/OrdersTab.tsx?raw';
import scheduleDayView from './views/schedule/hooks/useScheduleDayView.ts?raw';
import productsTable from './widgets/products-table/ui/ProductsTable.tsx?raw';

describe('Tauri confirmation dialogs', () => {
    it('does not use the plugin-dialog async window.confirm shim', () => {
        const forbidden = ['window', 'confirm'].join('.');
        const sources = [
            cuppingEventDetail,
            cuppingEventList,
            cuppingSampleSummary,
            channelsTab,
            ordersTab,
            scheduleDayView,
            productsTable,
        ];

        expect(sources.filter((source) => source.includes(forbidden))).toEqual([]);
    });
});
