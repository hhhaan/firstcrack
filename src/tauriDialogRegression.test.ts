import { describe, expect, it } from 'vitest';
import csvFileExport from './features/export-csv/useCsvFileExport.ts?raw';
import cuppingEventDetail from './views/cupping/ui/CuppingEventDetail.tsx?raw';
import cuppingEventList from './views/cupping/ui/CuppingEventList.tsx?raw';
import cuppingSampleSummary from './views/cupping/ui/CuppingSampleSummary.tsx?raw';
import channelsTab from './views/orders/ui/ChannelsTab.tsx?raw';
import ordersTab from './views/orders/ui/OrdersTab.tsx?raw';
import scheduleDayView from './views/schedule/hooks/useScheduleDayView.ts?raw';
import pendingRoastRecovery from './widgets/pending-roast-recovery/ui/PendingRoastRecovery.tsx?raw';
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
            csvFileExport,
        ];

        expect(sources.filter((source) => source.includes(forbidden))).toEqual([]);
    });

    it('cupping session delete uses an in-app modal, not plugin-dialog confirm', () => {
        expect(cuppingEventList).toContain('DeleteCuppingEventModal');
        expect(cuppingEventDetail).toContain('DeleteCuppingEventModal');
        expect(cuppingEventList).not.toMatch(/await confirm\(t\('cupping.deleteEventConfirm'/);
        expect(cuppingEventDetail).not.toMatch(/await confirm\(t\('cupping.deleteEventConfirm'/);
    });

    it('pending roast recovery discard uses an in-app modal, not plugin-dialog ask', () => {
        expect(pendingRoastRecovery).toContain('pending-roast-discard-modal');
        expect(pendingRoastRecovery).not.toMatch(/from '@tauri-apps\/plugin-dialog'/);
        expect(pendingRoastRecovery).not.toMatch(/\bask\(/);
    });
});
