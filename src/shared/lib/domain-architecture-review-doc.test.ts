/**
 * Structural guard for docs/domain-architecture-code-review.md.
 * Drives the shipped review artifact: ≥8 domains, three lenses, real path citations,
 * and greppable FSD patterns the doc claims are still present.
 *
 * Uses Vite `?raw` imports (same pattern as history-delete-description.test.ts)
 * so `tsc` under the browser tsconfig does not need Node types.
 */
import { describe, expect, it } from 'vitest';
import docBody from '../../../docs/domain-architecture-code-review.md?raw';
import orderDispatch from '../../../supabase/functions/order-dispatch/index.ts?raw';
import beanQueries from '../../entities/bean/queries.ts?raw';
import planQueries from '../../entities/plan/queries.ts?raw';
import roastQueries from '../../entities/roast/queries.ts?raw';
import roastTempChart from '../../features/active-roast/ui/RoastTempChart.tsx?raw';
import mainTsx from '../../main.tsx?raw';
import orders from '../../views/orders/Orders.tsx?raw';
import scheduleHook from '../../views/schedule/hooks/useScheduleDayView.ts?raw';
import useDashboard from '../../widgets/dashboard-summary/api/useDashboard.ts?raw';
import sidecar from './sidecar.ts?raw';

const CITED_SOURCES = [
    { rel: 'src/views/schedule/hooks/useScheduleDayView.ts', body: scheduleHook },
    { rel: 'src/entities/plan/queries.ts', body: planQueries },
    { rel: 'src/entities/roast/queries.ts', body: roastQueries },
    { rel: 'src/shared/lib/sidecar.ts', body: sidecar },
    { rel: 'src/views/orders/Orders.tsx', body: orders },
    { rel: 'src/features/active-roast/ui/RoastTempChart.tsx', body: roastTempChart },
    { rel: 'supabase/functions/order-dispatch/index.ts', body: orderDispatch },
    { rel: 'src/widgets/dashboard-summary/api/useDashboard.ts', body: useDashboard },
    { rel: 'src/entities/bean/queries.ts', body: beanQueries },
    { rel: 'src/main.tsx', body: mainTsx },
] as const;

describe('docs/domain-architecture-code-review.md', () => {
    it('exists and is non-empty', () => {
        expect(docBody.length).toBeGreaterThan(2000);
    });

    it('covers at least 8 numbered domain sections from the live product tree', () => {
        const sections = docBody.match(/^## \d+\. .+$/gm) ?? [];
        expect(sections.length).toBeGreaterThanOrEqual(8);
        expect(docBody).toMatch(/Active roast/i);
        expect(docBody).toMatch(/Inventory/i);
        expect(docBody).toMatch(/Orders/i);
        expect(docBody).toMatch(/Schedule/i);
        expect(docBody).toMatch(/History/i);
        expect(docBody).toMatch(/Sidecar/i);
        expect(docBody).toMatch(/Auth/i);
        expect(docBody).toMatch(/Supabase/i);
    });

    it('tags findings with smell, readability, and architecture lenses', () => {
        for (const lens of ['smell', 'readability', 'architecture'] as const) {
            expect(docBody.toLowerCase().includes(lens)).toBe(true);
        }
    });

    it('reconciles prior audits instead of only restating them', () => {
        expect(docBody).toMatch(/Prior audit reconcile/i);
        expect(docBody).toMatch(/still true/i);
        expect(docBody).toMatch(/fixed/i);
        expect(docBody).toMatch(/production-readiness-audit/);
        expect(docBody).toMatch(/refactor-plan/);
    });

    it('cites real paths that still resolve as source modules', () => {
        for (const { rel, body } of CITED_SOURCES) {
            expect(body.length, `cited path empty/missing: ${rel}`).toBeGreaterThan(0);
            const fragment = rel.split('/').slice(-2).join('/');
            expect(docBody.includes(fragment) || docBody.includes(rel), `doc missing citation for ${rel}`).toBe(true);
        }
    });

    it('documents still-present FSD patterns that greps find in shipped code', () => {
        expect(roastQueries).toMatch(/bean-stock-event|roasted-stock-event/);
        expect(sidecar).toMatch(/@entities\/machine/);
        expect(scheduleHook).toMatch(/useDayBatches\(userId, dateKey, 14\)/);
        expect(orderDispatch).toMatch(/sales_channels/);
    });
});
