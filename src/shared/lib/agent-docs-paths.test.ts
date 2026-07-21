/**
 * Structural guard for English agent docs written under docs/agent/ + inventory SSoT + supabase/AGENTS.md.
 * Ensures shipped docs stay English (no Hangul), cite modules that still resolve, and avoid known phantom paths.
 */
import { describe, expect, it } from 'vitest';
import activeRoastSave from '../../../docs/agent/active-roast-save.md?raw';
import dataFetching from '../../../docs/agent/data-fetching.md?raw';
import gapInventory from '../../../docs/agent/gap-inventory.md?raw';
import inventoryLedger from '../../../docs/agent/inventory-ledger.md?raw';
import salesChannels from '../../../docs/agent/sales-channels-orders.md?raw';
import schedulePlan from '../../../docs/agent/schedule-plan.md?raw';
import workspaceAuth from '../../../docs/agent/workspace-auth.md?raw';
import inventoryArch from '../../../docs/inventory-architecture.md?raw';
import supabaseAgents from '../../../supabase/AGENTS.md?raw';
import featuresIndex from './features/index.ts?raw';
import planMatrix from './features/plan-matrix.ts?raw';
import queryKeys from './query-keys.ts?raw';
import sidecar from './sidecar.ts?raw';
import supabaseClient from './supabase.ts?raw';

const AGENT_DOCS = {
    'docs/agent/gap-inventory.md': gapInventory,
    'docs/inventory-architecture.md': inventoryArch,
    'docs/agent/inventory-ledger.md': inventoryLedger,
    'docs/agent/active-roast-save.md': activeRoastSave,
    'docs/agent/schedule-plan.md': schedulePlan,
    'docs/agent/sales-channels-orders.md': salesChannels,
    'docs/agent/workspace-auth.md': workspaceAuth,
    'docs/agent/data-fetching.md': dataFetching,
    'supabase/AGENTS.md': supabaseAgents,
} as const;

/** Hangul syllables — agent docs for this goal must be English body. */
const HANGUL = /[\uAC00-\uD7A3]/;

const CITED_RESOLVE = [
    { rel: 'src/shared/lib/supabase.ts', body: supabaseClient },
    { rel: 'src/shared/lib/sidecar.ts', body: sidecar },
    { rel: 'src/shared/lib/query-keys.ts', body: queryKeys },
    { rel: 'src/shared/lib/features/plan-matrix.ts', body: planMatrix },
    { rel: 'src/shared/lib/features/index.ts', body: featuresIndex },
] as const;

describe('agent domain docs (English path SSoT)', () => {
    it('covers ≥8 product domains in the gap inventory', () => {
        expect(gapInventory.length).toBeGreaterThan(500);
        const domainRows = gapInventory.match(/^\| \d+ \|/gm) ?? [];
        expect(domainRows.length).toBeGreaterThanOrEqual(8);
        for (const name of [
            'active-roast',
            'inventory',
            'orders',
            'schedule',
            'sidecar',
            'auth',
            'supabase',
            'shared',
        ]) {
            expect(gapInventory.toLowerCase()).toContain(name);
        }
    });

    it('keeps agent deliverable bodies English (no Hangul syllables)', () => {
        for (const [rel, body] of Object.entries(AGENT_DOCS)) {
            expect(HANGUL.test(body), `Hangul found in ${rel}`).toBe(false);
            expect(body.length, rel).toBeGreaterThan(200);
        }
    });

    it('does not cite known phantom modules', () => {
        const all = Object.values(AGENT_DOCS).join('\n');
        expect(all).not.toMatch(/src\/shared\/lib\/axios\.ts/);
        expect(all).not.toMatch(/src\/shared\/lib\/features\.ts`/);
        expect(all).not.toMatch(/src\/shared\/lib\/features\.ts\)/);
    });

    it('cites real shared modules that still resolve as source', () => {
        for (const { rel, body } of CITED_RESOLVE) {
            expect(body.length, `missing shipped module ${rel}`).toBeGreaterThan(0);
        }
        expect(dataFetching).toContain('src/shared/lib/supabase.ts');
        expect(dataFetching).toContain('src/shared/lib/sidecar.ts');
        expect(dataFetching).not.toContain('axios.ts');
        expect(activeRoastSave).toMatch(/src\/shared\/lib\/features\//);
        expect(schedulePlan).toMatch(/src\/shared\/lib\/features\//);
        expect(inventoryArch).toContain('src/entities/bean-stock-event/api.ts');
        expect(supabaseAgents).toContain('get-upload-url');
        expect(workspaceAuth).toContain('src/entities/organization/model.ts');
        expect(salesChannels).toContain('src/entities/order/api.ts');
    });

    it('inventory architecture documents three ledgers and RPC write authority', () => {
        expect(inventoryArch).toMatch(/bean_stock_events/);
        expect(inventoryArch).toMatch(/roasted_stock_events/);
        expect(inventoryArch).toMatch(/product_stock_events/);
        expect(inventoryArch).toMatch(/fulfill_order|upsert_roasted_inbound|insert_packaging_op/);
    });
});
