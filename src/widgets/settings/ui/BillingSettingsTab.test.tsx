import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BillingSettingsTab } from './BillingSettingsTab';

const mocks = vi.hoisted(() => ({
    plan: 'trial-event',
    workspaceReady: true,
    now: Date.parse('2026-11-06T00:00:00Z'),
    usage: undefined as
        | {
              batch_cap?: number | null;
              used_batches: number;
              reserved_batches: number;
              period_end: string;
          }
        | undefined,
}));

vi.mock('@entities/organization', () => ({
    useActiveWorkspace: () => ({
        workspaceOwnerId: 'owner-1',
        isForeignWorkspace: false,
        isWorkspaceReady: mocks.workspaceReady,
    }),
}));
vi.mock('@entities/profile', () => ({ useProfile: () => ({ data: { plan: mocks.plan } }) }));
vi.mock('@shared/lib/features', () => ({
    TRIAL_BATCH_CAP: 20,
    TRIAL_EVENT_BATCH_CAP: 100,
    useRoastChargeUsage: () => ({ data: mocks.usage }),
}));
vi.mock('@shared/lib/features/useExpiryClock', () => ({ useExpiryClock: () => mocks.now }));
vi.mock('@shared/lib/logger', () => ({ logger: { capture: vi.fn() } }));
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn() }));
vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, values?: { days: number; batches: number }) =>
            values ? `${key}:days=${values.days},batches=${values.batches}` : key,
    }),
}));

const render = () => renderToStaticMarkup(createElement(BillingSettingsTab));
const trialStatus = 'settings.tabs.billing.trialStatus';

describe('BillingSettingsTab trial batch remainder', () => {
    beforeEach(() => {
        mocks.plan = 'trial-event';
        mocks.workspaceReady = true;
        mocks.usage = {
            batch_cap: 200,
            used_batches: 1,
            reserved_batches: 7,
            period_end: '2026-11-16T00:00:00Z',
        };
    });

    it('shows server cap 200 minus one used as 199, without subtracting reservations', () => {
        const html = render();
        expect(html).toContain(`${trialStatus}:days=10,batches=199`);
        expect(html).not.toContain('batches=192');
        // The unrelated credits card stays pending, with its purchase/history actions disabled.
        expect(html).toContain('settings.tabs.billing.creditsPending');
        expect(html).toContain('settings.tabs.billing.creditsSettings');
        expect(html.match(/disabled=""/g)).toHaveLength(2);
    });

    it('shows the default server cap 100 minus one used as 99', () => {
        if (mocks.usage) mocks.usage.batch_cap = 100;
        expect(render()).toContain(`${trialStatus}:days=10,batches=99`);
    });

    it.each([undefined, null])('falls back to legacy trial-event 100 only for absent cap %s', (cap) => {
        if (mocks.usage) mocks.usage.batch_cap = cap;
        expect(render()).toContain(`${trialStatus}:days=10,batches=99`);
    });

    it('preserves ordinary trial fallback of 20 when the server cap is absent', () => {
        mocks.plan = 'trial';
        if (mocks.usage) mocks.usage.batch_cap = null;
        expect(render()).toContain(`${trialStatus}:days=10,batches=19`);
    });

    it.each([
        [0, 0],
        [200, 200],
        [200, 201],
    ])('shows exhausted/read-only state for cap %i and used %i', (cap, used) => {
        if (mocks.usage) {
            mocks.usage.batch_cap = cap;
            mocks.usage.used_batches = used;
            mocks.usage.reserved_batches = 0;
        }
        const html = render();
        expect(html).toContain('settings.tabs.billing.readOnlyDesc');
        expect(html).not.toContain(trialStatus);
    });

    it('keeps the loading message instead of showing a fallback allowance before usage arrives', () => {
        mocks.usage = undefined;
        const html = render();
        expect(html).toContain('settings.tabs.billing.trialEventLoading');
        expect(html).not.toContain(trialStatus);
    });

    it('keeps the workspace-loading skeleton before the workspace is ready', () => {
        mocks.workspaceReady = false;
        const html = render();
        expect(html.match(/animate-pulse/g)).toHaveLength(2);
        expect(html).not.toContain(trialStatus);
    });
});
