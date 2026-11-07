// @vitest-environment jsdom

import type { ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProfileRoastSummary } from './ProfileRoastSummary';

const settings = vi.hoisted<{ temperatureUnit: 'C' | 'F' }>(() => ({ temperatureUnit: 'C' }));
vi.mock('@features/active-roast', async () => ({
    formatTemp: (await import('@features/active-roast/lib/temperature')).formatTemp,
    useRoastSettings: () => settings,
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const profile = {
    duration_sec: 600,
    charge_temp_celsius: 180,
    drop_temp_celsius: 200,
    dev_time_sec: 120,
    dev_pct: 20,
    target_level: 'Medium',
    machine_name: 'A long roaster name that should remain available in full',
} satisfies ComponentProps<typeof ProfileRoastSummary>['profile'];

const definitions = (value: ComponentProps<typeof ProfileRoastSummary>['profile']) => {
    const host = document.createElement('div');
    host.innerHTML = renderToStaticMarkup(<ProfileRoastSummary profile={value} />);
    return [...host.querySelectorAll('dl > div')].map((group) => ({
        term: group.querySelector('dt')?.textContent,
        value: group.querySelector('dd')?.textContent,
    }));
};

describe('ProfileRoastSummary', () => {
    afterEach(() => {
        settings.temperatureUnit = 'C';
    });

    it.each([
        { unit: 'C', temperatures: '180.0°C→200.0°C' },
        { unit: 'F', temperatures: '356.0°F→392.0°F' },
    ] as const)('keeps all measurements and metadata in $unit', ({ unit, temperatures }) => {
        settings.temperatureUnit = unit;
        expect(definitions(profile)).toEqual([
            { term: 'profiles.detail.totalDuration', value: '10:00' },
            { term: 'profiles.detail.chargeTemp→profiles.detail.dropTemp', value: temperatures },
            { term: 'profiles.detail.devTime/profiles.detail.devPct', value: '2:00/20.0%' },
            { term: 'profiles.detail.targetLevel', value: 'Medium' },
            { term: 'profiles.detail.machine', value: profile.machine_name },
        ]);
    });

    it('distinguishes missing measurements from recorded zeros', () => {
        expect(
            definitions({
                duration_sec: null,
                charge_temp_celsius: 0,
                drop_temp_celsius: null,
                dev_time_sec: 0,
                dev_pct: 0,
                target_level: null,
                machine_name: null,
            }).map(({ value }) => value),
        ).toEqual(['—', '0.0°C→—', '0:00/0.0%', '—', '—']);
    });
});
