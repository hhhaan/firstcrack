import { inventoryQueryRoots } from '@shared/lib/query-keys';
import { describe, expect, it } from 'vitest';
import { inventoryAlertKeys } from './queries';

describe('inventoryAlertKeys compose from inventoryQueryRoots', () => {
    it('list nests under the shared alerts root', () => {
        expect(inventoryAlertKeys.all).toBe(inventoryQueryRoots.inventoryAlerts);
        expect(inventoryAlertKeys.list('u1')).toEqual([...inventoryQueryRoots.inventoryAlerts, 'u1']);
    });
});
