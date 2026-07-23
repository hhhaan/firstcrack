/**
 * Structural guard for docs/agent/fsd-page-first-inventory.md.
 * Drives the shipped inventory: one subsection per route view, page-first rule,
 * real path citations, and greppable hard-violation patterns still present.
 *
 * Uses Vite `?raw` imports (same pattern as domain-architecture-review-doc.test.ts).
 */
import { describe, expect, it } from 'vitest';
import inventory from '../../../docs/agent/fsd-page-first-inventory.md?raw';
import appTsx from '../../App.tsx?raw';
import history from '../../views/history/History.tsx?raw';
import historyTable from '../../views/history/ui/HistoryTable.tsx?raw';
import machines from '../../views/machines/Machines.tsx?raw';
import orders from '../../views/orders/Orders.tsx?raw';
import scheduleHook from '../../views/schedule/hooks/useScheduleDayView.ts?raw';
import beanList from '../../widgets/bean-list/ui/BeanList.tsx?raw';
import useDashboard from '../../widgets/dashboard-summary/api/useDashboard.ts?raw';
import profileDetail from '../../widgets/profile-detail/ui/ProfileDetail.tsx?raw';
import roastingCard from '../../widgets/roasting-requirements-card/ui/RoastingRequirementsCard.tsx?raw';
import sidecar from './sidecar.ts?raw';

/** Route-level pages under src/views — must match App.tsx imports + inventory headings. */
const ROUTE_PAGES = [
    'active-roast',
    'bean',
    'cupping',
    'dashboard',
    'history',
    'login',
    'machines',
    'orders',
    'pricing',
    'profiles',
    'schedule',
] as const;

describe('docs/agent/fsd-page-first-inventory.md', () => {
    it('exists and is non-empty', () => {
        expect(inventory.length).toBeGreaterThan(3000);
    });

    it('states page-first co-location as primary placement rule', () => {
        expect(inventory).toMatch(/page-owned UI\/hooks stay under that page/i);
        expect(inventory).toMatch(/keep-in-view/i);
        expect(inventory).toMatch(/Do \*\*not\*\* extract page-only/i);
    });

    it('does not contradict unidirectional layer direction', () => {
        expect(inventory).toMatch(/shared → entities → features → widgets → views → app/);
        // Must not recommend reverse layer imports as the placement rule
        expect(inventory).not.toMatch(/views → entities → shared/);
    });

    it('has one numbered subsection per route-level page (11)', () => {
        for (const page of ROUTE_PAGES) {
            // "## N. schedule" style headings
            const re = new RegExp(`^## \\d+\\. ${page}\\s*$`, 'm');
            expect(inventory, `missing inventory section for ${page}`).toMatch(re);
        }
        const sectionCount = (inventory.match(/^## \d+\. /gm) ?? []).length;
        expect(sectionCount).toBe(ROUTE_PAGES.length);
    });

    it('App.tsx mounts all 11 view entries', () => {
        expect(appTsx).toMatch(/views\/active-roast\/ActiveRoast/);
        expect(appTsx).toMatch(/views\/bean\/Beans/);
        expect(appTsx).toMatch(/views\/cupping\/Cupping/);
        expect(appTsx).toMatch(/views\/dashboard\/Dashboard/);
        expect(appTsx).toMatch(/views\/history\/History/);
        expect(appTsx).toMatch(/views\/login\/Login/);
        expect(appTsx).toMatch(/views\/machines\/Machines/);
        expect(appTsx).toMatch(/views\/orders\/Orders/);
        expect(appTsx).toMatch(/views\/pricing\/Pricing/);
        expect(appTsx).toMatch(/views\/profiles\/Profiles/);
        expect(appTsx).toMatch(/views\/schedule\/Schedule/);
    });

    it('cites concrete in-repo paths for high-risk pages', async () => {
        // Spot-check entries resolve and are cited
        const requiredFragments = [
            'views/schedule/hooks/useScheduleDayView.ts',
            'views/orders/Orders.tsx',
            'views/machines/Machines.tsx',
            'views/history/History.tsx',
            'widgets/dashboard-summary/api/useDashboard.ts',
            'views/active-roast/ui/RoastTempChart',
        ];
        for (const frag of requiredFragments) {
            expect(inventory.includes(frag), `doc missing path ${frag}`).toBe(true);
        }
        expect(scheduleHook.length).toBeGreaterThan(100);
        expect(orders.length).toBeGreaterThan(100);
        expect(machines.length).toBeGreaterThan(100);
    });

    it('each page section includes at least one placement decision keyword', () => {
        for (const page of ROUTE_PAGES) {
            const re = new RegExp(`^## \\d+\\. ${page}\\s*$([\\s\\S]*?)(?=^## \\d+\\. |^## Hard violations)`, 'm');
            const m = inventory.match(re);
            expect(m, `could not slice section for ${page}`).toBeTruthy();
            const body = m?.[1] ?? '';
            const hasDecision = /keep-in-view|already-ok|Placement decision|Recommended home|optional colocate/i.test(
                body,
            );
            expect(hasDecision, `page ${page} lacks placement decision`).toBe(true);
        }
    });

    it('documents hard violations that greps still find in shipped code', () => {
        // V1 cross-view NewProfileModal
        expect(history).toMatch(/@views\/profiles\/NewProfileModal/);
        expect(inventory).toMatch(/NewProfileModal/);

        // V2 cross-view RoastTempChart
        expect(historyTable).toMatch(/@views\/active-roast\/ui\/RoastTempChart/);
        expect(inventory).toMatch(/RoastTempChart/);

        // V3 widget supabase
        expect(useDashboard).toMatch(/@shared\/lib\/supabase/);
        expect(inventory).toMatch(/useDashboard\.ts/);

        // V4 machines setInterval poll
        expect(machines).toMatch(/setInterval/);
        expect(machines).toMatch(/sidecar/);

        // V5 schedule god hook still plan-heavy
        expect(scheduleHook).toMatch(/useCreatePlanBatch|createBatch|complete/);

        // V7 shared→entities
        expect(sidecar).toMatch(/@entities\/machine/);
    });

    it('spot-checks single-consumer widgets remain page-scoped (bean/profile/orders)', () => {
        // These files exist (shipped) — inventory classifies them as page-only candidates
        expect(beanList.length).toBeGreaterThan(0);
        expect(profileDetail.length).toBeGreaterThan(0);
        expect(roastingCard.length).toBeGreaterThan(0);
        expect(inventory).toMatch(/bean-list/);
        expect(inventory).toMatch(/profile-detail/);
        expect(inventory).toMatch(/roasting-requirements-card/);
        // Orders is the roasting card consumer
        expect(orders).toMatch(/RoastingRequirementsCard|roasting-requirements-card/);
    });

    it('orders by practical maintenance risk with schedule/orders first', () => {
        const riskTable = inventory.slice(inventory.indexOf('## Risk order'), inventory.indexOf('## 1. schedule'));
        expect(riskTable).toMatch(/schedule/);
        expect(riskTable).toMatch(/orders/);
        // schedule row before orders in risk table
        expect(riskTable.indexOf('schedule')).toBeLessThan(riskTable.indexOf('| 2 | orders'));
    });

    it('defers CQ-R1–R6 full rewrites', () => {
        expect(inventory).toMatch(/CQ-R1/);
        expect(inventory).toMatch(/defer/i);
        expect(inventory).toMatch(/Non-goals|Deferred/i);
    });
});
