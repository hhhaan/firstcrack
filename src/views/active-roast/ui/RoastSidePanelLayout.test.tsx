// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { buildRoastLogDisplayEntries } from '../lib/display-derivatives';
import { RoastSidePanelLayout } from './RoastSidePanelLayout';

const settings = vi.hoisted(() => ({ logExpanded: false }));
vi.mock('@features/active-roast/model/settings', () => ({
    useRoastSettings: () => settings,
    updateRoastSettings: vi.fn(),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it.each([false, true])('orders automatic marks and manual controls by event time (expanded=%s)', (expanded) => {
    settings.logExpanded = expanded;
    const entries = buildRoastLogDisplayEntries(
        [
            { id: 'gas', time: '1:00', event: 'Heater', temp: '', note: '' },
            { id: 'yellow', time: '2:00', event: 'Yellow', temp: '', note: '' },
            { id: 'air', time: '3:00', event: 'Fan', temp: '', note: '' },
            { id: 'charge', time: '0:00', event: 'Charge', temp: '', note: '' },
        ],
        true,
        false,
        '',
        null,
        '',
        'C',
    );
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    try {
        act(() =>
            root.render(
                <RoastSidePanelLayout roastLogDisplayEntries={entries} onRemoveLogEntry={vi.fn()}>
                    {null}
                </RoastSidePanelLayout>,
            ),
        );
        const text = host.textContent ?? '';
        expect(text.indexOf('0:00')).toBeLessThan(text.indexOf('1:00'));
        expect(text.indexOf('1:00')).toBeLessThan(text.indexOf('2:00'));
        expect(text.indexOf('2:00')).toBeLessThan(text.indexOf('3:00'));
    } finally {
        act(() => root.unmount());
        host.remove();
    }
});
