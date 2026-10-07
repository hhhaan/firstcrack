// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ControlLimits } from './control-channels';
import { useEffectiveControlLimits } from './useEffectiveControlLimits';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const HEATER_LIMITS: ControlLimits = { heater: { min: 0, max: 100, unit: '%' } };
const DRUM_LIMITS: ControlLimits = {
    drum: { min: 0, max: 100, unit: '%' },
    heater: { min: 0, max: 100, unit: '%' },
    fan: { min: 0, max: 100, unit: '%' },
};

describe('useEffectiveControlLimits', () => {
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

    it('does not loop setState on the live connected path across re-renders', () => {
        const renderCount = { n: 0 };
        let latest: ControlLimits | undefined;
        const Probe = () => {
            renderCount.n += 1;
            latest = useEffectiveControlLimits({
                machineId: 'machine-live',
                roasterKey: 'virtual',
                statusLimits: HEATER_LIMITS,
                statusLimitsReceived: true,
                useStickyPresentation: false,
            });
            return null;
        };
        act(() => {
            root.render(createElement(Probe));
        });
        act(() => {
            root.render(createElement(Probe));
        });
        act(() => {
            root.render(createElement(Probe));
        });
        act(() => {
            root.render(createElement(Probe));
        });
        expect(renderCount.n).toBeLessThanOrEqual(6);
        expect(latest).toBe(HEATER_LIMITS);
    });

    it('does not leak limits between two machine ids on the same preset', () => {
        let latest: ControlLimits | undefined;
        const Probe = ({ machineId, statusLimits }: { machineId: string; statusLimits: ControlLimits }) => {
            latest = useEffectiveControlLimits({
                machineId,
                roasterKey: 'custom_modbus',
                statusLimits,
                statusLimitsReceived: true,
                useStickyPresentation: false,
            });
            return null;
        };
        act(() => {
            root.render(createElement(Probe, { machineId: 'machine-a', statusLimits: DRUM_LIMITS }));
        });
        expect(latest).toBe(DRUM_LIMITS);
        act(() => {
            root.render(createElement(Probe, { machineId: 'machine-b', statusLimits: {} }));
        });
        expect(latest).toEqual({});
        expect(latest?.drum).toBeUndefined();
    });
});
