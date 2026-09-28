// @vitest-environment jsdom
import { deltaOrNull } from '@shared/lib/roast-delta';
import type { RoastProfile } from '@shared/types/database.types';
import { act, type ComponentProps } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { SessionScorecard } from './SessionScorecard';

const profile = {
    id: 'profile-1',
    name: 'Testim',
    charge_temp_celsius: 200,
    drop_temp_celsius: 169,
    duration_sec: 480,
    dev_time_sec: 90,
    dev_pct: 18,
} as RoastProfile;

vi.mock('@entities/roast-profile', async () => {
    const actual = await vi.importActual<typeof import('@entities/roast-profile')>('@entities/roast-profile');
    return {
        ...actual,
        useRoastProfiles: () => ({ data: [profile] }),
    };
});
vi.mock('@features/active-roast', async () => ({
    ...(await vi.importActual('@features/active-roast/lib/temperature')),
    useRoastSettings: () => ({ temperatureUnit: 'C' }),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const session = {
    id: 's1',
    user_id: 'owner',
    profile_id: 'profile-1',
    duration_seconds: 660,
    charge_temp_celsius: 208,
    drop_temp_celsius: 208,
    events: [
        { id: 'c', type: 'Charge', time_sec: 0, temp_c: 210 },
        { id: 'd', type: 'Drop', time_sec: 600, temp_c: 208 },
        { id: 'e', type: 'End', time_sec: 660, temp_c: 208 },
    ],
} as unknown as ComponentProps<typeof SessionScorecard>['session'];

describe('SessionScorecard charge vs drop (#492)', () => {
    it('compares Charge vs Charge (210/200), not Drop vs Drop (208/169)', async () => {
        expect(deltaOrNull(210, 200)).toBe(10);
        expect(deltaOrNull(208, 169)).toBe(39);

        const container = document.createElement('div');
        const root = createRoot(container);
        await act(async () => {
            root.render(<SessionScorecard session={session} />);
        });

        const chargeLabel = [...container.querySelectorAll('div')].find(
            (el) => el.textContent === 'history.table.chargeTemp',
        );
        expect(chargeLabel).toBeTruthy();
        const chargeBlock = chargeLabel?.parentElement;
        expect(chargeBlock?.textContent).toContain('210°C');
        expect(chargeBlock?.textContent).toContain('200°C');
        expect(chargeBlock?.textContent).toContain('+10.0°C');
        expect(chargeBlock?.textContent).not.toContain('208.0°C');
        expect(chargeBlock?.textContent).not.toContain('169.0°C');
        expect(chargeBlock?.textContent).not.toContain('+39.0°C');

        const dropLabel = [...container.querySelectorAll('div')].find(
            (el) => el.textContent === 'history.table.dropTemp',
        );
        expect(dropLabel?.parentElement?.textContent).toContain('208°C');
        expect(dropLabel?.parentElement?.textContent).toContain('169°C');

        await act(async () => root.unmount());
    });
});
