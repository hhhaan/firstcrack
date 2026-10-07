// @vitest-environment jsdom

import { layoutControlAxes, resolveControlUnits } from '@features/active-roast/lib/control-channels';
import { buildControlLiveReadout, buildControlReadoutGroups } from '@features/active-roast/lib/control-readout';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ControlReadoutStrip } from './ControlReadoutStrip';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('ControlReadoutStrip', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    it('renders measured values and stale/offline tags', () => {
        const units = resolveControlUnits();
        const axes = layoutControlAxes({ drum: true, heat: true, fan: true }, units, 0, 100);
        const live = buildControlLiveReadout({
            liveData: { heater: 35, fan: 80, drum: 55 },
            capabilities: ['heater', 'fan', 'drum'],
            connected: true,
            reconnecting: false,
            quality: 'stale',
            pollIntervalMs: 1000,
            nowMs: 10_000,
            lastValidReceivedAtMs: 10_000,
        });
        const groups = buildControlReadoutGroups({
            shown: { drum: true, heat: true, fan: true },
            axes,
            units,
            live,
            hasHeatSet: false,
        });
        act(() => root.render(createElement(ControlReadoutStrip, { groups, style: {} })));
        expect(container.querySelector('[data-testid="control-readout"]')?.getAttribute('data-state')).toBe('stale');
        expect(container.textContent).toContain('activeRoast.chart.controlReadout.stale');
        expect(container.querySelector('[data-testid="control-readout-drum"]')?.textContent).toContain('55');
    });
});
