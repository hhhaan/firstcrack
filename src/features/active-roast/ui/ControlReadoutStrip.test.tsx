// @vitest-environment jsdom

import { mockChartColors as mockColors } from '@features/active-roast/lib/chart-option/chart-colors.fixture';
import { layoutControlAxes, resolveControlUnits } from '@features/active-roast/lib/control-channels';
import { buildControlLiveReadout, buildControlReadoutGroups } from '@features/active-roast/lib/control-readout';
import {
    canvasCurveTokens,
    controlLiveLineStyle,
    DEFAULT_CURVE_STYLES,
    resolveCurveStyles,
} from '@features/active-roast/lib/curve-style';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ControlReadoutStrip, controlReadoutSwatchStyle } from './ControlReadoutStrip';

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
        const curves = resolveCurveStyles(
            { ...DEFAULT_CURVE_STYLES, drum: { ...DEFAULT_CURVE_STYLES.drum, color: '#aabbcc' } },
            canvasCurveTokens(mockColors),
        );
        act(() => root.render(createElement(ControlReadoutStrip, { groups, style: {}, curves })));
        expect(container.querySelector('[data-testid="control-readout"]')?.getAttribute('data-state')).toBe('stale');
        expect(container.textContent).toContain('activeRoast.chart.controlReadout.stale');
        expect(container.querySelector('[data-testid="control-readout-drum"]')?.textContent).toContain('55');
        const swatch = container.querySelector('[aria-hidden="true"]') as HTMLElement | null;
        expect(swatch?.style.borderTop).toContain('rgb(170, 187, 204)');
    });

    it('uses heat current color for the profile target swatch, not the reference background', () => {
        const heatColor = '#ff5500';
        const curves = resolveCurveStyles(
            { ...DEFAULT_CURVE_STYLES, heat: { ...DEFAULT_CURVE_STYLES.heat, color: heatColor, width: 4 } },
            canvasCurveTokens(mockColors),
        );
        const targetStyle = controlReadoutSwatchStyle({ channel: 'heat', kind: 'target' }, curves);
        expect(targetStyle).toEqual(controlLiveLineStyle(curves.heat.current, 'heatTarget'));
        expect(targetStyle.color).toBe(heatColor);
        expect(targetStyle.type).toBe('dotted');
        expect(targetStyle.color).not.toBe(curves.heat.background.color);

        const units = resolveControlUnits();
        const axes = layoutControlAxes({ drum: false, heat: true, fan: false }, units, 0, 100);
        const live = buildControlLiveReadout({
            liveData: { heater: 40, fan: 0, drum: 0 },
            capabilities: ['heater'],
            connected: true,
            reconnecting: false,
            quality: 'valid',
            pollIntervalMs: 1000,
            nowMs: 10_000,
            lastValidReceivedAtMs: 10_000,
        });
        const groups = buildControlReadoutGroups({
            shown: { drum: false, heat: true, fan: false },
            axes,
            units,
            live,
            hasHeatSet: true,
            heatTargetNow: 70,
        });
        act(() => root.render(createElement(ControlReadoutStrip, { groups, style: {}, curves })));
        const targetIdx = groups.right.findIndex((e) => e.key === 'heat-target');
        const swatches = [...container.querySelectorAll('[aria-hidden="true"]')] as HTMLElement[];
        expect(swatches[targetIdx]?.style.borderTop).toContain('rgb(255, 85, 0)');
        expect(swatches[targetIdx]?.style.borderTop).toContain('dotted');
    });

    it('keeps measured, set, and target swatches on the channel current curve style', () => {
        const curves = resolveCurveStyles(
            {
                ...DEFAULT_CURVE_STYLES,
                heat: { ...DEFAULT_CURVE_STYLES.heat, color: '#224466', width: 3 },
            },
            canvasCurveTokens(mockColors),
        );
        expect(controlReadoutSwatchStyle({ channel: 'heat', kind: 'measured' }, curves)).toEqual(curves.heat.current);
        expect(controlReadoutSwatchStyle({ channel: 'heat', kind: 'set' }, curves)).toEqual(
            controlLiveLineStyle(curves.heat.current, 'set'),
        );
        expect(controlReadoutSwatchStyle({ channel: 'heat', kind: 'target' }, curves)).toEqual(
            controlLiveLineStyle(curves.heat.current, 'heatTarget'),
        );
    });
});
