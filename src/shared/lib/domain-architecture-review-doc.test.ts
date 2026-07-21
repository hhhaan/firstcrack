/**
 * Structural guard for docs/domain-architecture-code-review.md.
 * Drives the shipped review artifact: ≥8 domains, three lenses, real path citations,
 * and greppable FSD patterns the doc claims are still present.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '../../..');
const DOC = join(ROOT, 'docs/domain-architecture-code-review.md');

const REQUIRED_CITATIONS = [
    'src/views/schedule/hooks/useScheduleDayView.ts',
    'src/entities/plan/queries.ts',
    'src/entities/roast/queries.ts',
    'src/shared/lib/sidecar.ts',
    'src/views/orders/Orders.tsx',
    'src/views/active-roast/ui/RoastTempChart.tsx',
    'supabase/functions/order-dispatch/index.ts',
    'src/widgets/dashboard-summary/api/useDashboard.ts',
    'src/entities/bean/queries.ts',
    'src/main.tsx',
] as const;

describe('docs/domain-architecture-code-review.md', () => {
    it('exists and is non-empty', () => {
        expect(existsSync(DOC)).toBe(true);
        const body = readFileSync(DOC, 'utf8');
        expect(body.length).toBeGreaterThan(2000);
    });

    it('covers at least 8 numbered domain sections from the live product tree', () => {
        const body = readFileSync(DOC, 'utf8');
        const sections = body.match(/^## \d+\. .+$/gm) ?? [];
        expect(sections.length).toBeGreaterThanOrEqual(8);
        expect(body).toMatch(/Active roast/i);
        expect(body).toMatch(/Inventory/i);
        expect(body).toMatch(/Orders/i);
        expect(body).toMatch(/Schedule/i);
        expect(body).toMatch(/History/i);
        expect(body).toMatch(/Sidecar/i);
        expect(body).toMatch(/Auth/i);
        expect(body).toMatch(/Supabase/i);
    });

    it('tags findings with smell, readability, and architecture lenses', () => {
        const body = readFileSync(DOC, 'utf8');
        for (const lens of ['smell', 'readability', 'architecture'] as const) {
            expect(body.toLowerCase().includes(lens)).toBe(true);
        }
    });

    it('reconciles prior audits instead of only restating them', () => {
        const body = readFileSync(DOC, 'utf8');
        expect(body).toMatch(/Prior audit reconcile/i);
        expect(body).toMatch(/still true/i);
        expect(body).toMatch(/fixed/i);
        expect(body).toMatch(/production-readiness-audit/);
        expect(body).toMatch(/refactor-plan/);
    });

    it('cites real paths that still exist on disk', () => {
        const body = readFileSync(DOC, 'utf8');
        for (const rel of REQUIRED_CITATIONS) {
            const abs = join(ROOT, rel);
            expect(existsSync(abs), `cited path missing: ${rel}`).toBe(true);
            const fragment = rel.split('/').slice(-2).join('/');
            expect(body.includes(fragment) || body.includes(rel), `doc missing citation for ${rel}`).toBe(true);
        }
    });

    it('documents still-present FSD patterns that greps find in shipped code', () => {
        const roastQueries = readFileSync(join(ROOT, 'src/entities/roast/queries.ts'), 'utf8');
        expect(roastQueries).toMatch(/bean-stock-event|roasted-stock-event/);

        const sidecar = readFileSync(join(ROOT, 'src/shared/lib/sidecar.ts'), 'utf8');
        expect(sidecar).toMatch(/@entities\/machine/);

        const schedule = readFileSync(join(ROOT, 'src/views/schedule/hooks/useScheduleDayView.ts'), 'utf8');
        expect(schedule).toMatch(/useDayBatches\(userId, dateKey, 14\)/);

        const dispatch = readFileSync(join(ROOT, 'supabase/functions/order-dispatch/index.ts'), 'utf8');
        expect(dispatch).toMatch(/sales_channels/);
    });
});
