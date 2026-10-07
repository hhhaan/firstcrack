import { describe, expect, it } from 'vitest';
import {
    deadbandSpanForChannel,
    layoutControlAxes,
    resolveControlUnits,
    resolveEffectiveControlLimits,
} from './control-channels';
import { resolveSupportedControlChannels } from './supported-control-channels';

describe('resolveEffectiveControlLimits', () => {
    const machineA = 'machine-a';
    const machineB = 'machine-b';
    const preset = 'custom_modbus';
    const limitsA = {
        drum: { min: 0, max: 100, unit: '%' },
        heater: { min: 0, max: 100, unit: '%' },
        fan: { min: 0, max: 100, unit: '%' },
    };

    it('does not leak limits between two machines on the same preset', () => {
        let cache = null;
        let resolved = resolveEffectiveControlLimits({
            cache,
            identity: machineA,
            statusLimits: limitsA,
            statusLimitsReceived: true,
            useStickyPresentation: false,
        });
        cache = resolved.cache;
        resolved = resolveEffectiveControlLimits({
            cache,
            identity: machineB,
            statusLimits: {},
            statusLimitsReceived: true,
            useStickyPresentation: false,
        });
        expect(resolved.limits).toEqual({});
        expect(resolved.limits?.drum).toBeUndefined();
        expect(resolved.limits?.fan).toBeUndefined();
        const supported = resolveSupportedControlChannels({
            roasterKey: preset,
            capabilities: [],
            limits: resolved.limits,
        });
        expect(supported.drum).toBe(false);
        expect(supported.fan).toBe(false);
    });

    it('follows connected status with empty limits instead of sticky cache', () => {
        let cache = null;
        let resolved = resolveEffectiveControlLimits({
            cache,
            identity: machineA,
            statusLimits: limitsA,
            statusLimitsReceived: true,
            useStickyPresentation: false,
        });
        cache = resolved.cache;
        resolved = resolveEffectiveControlLimits({
            cache,
            identity: machineA,
            statusLimits: {},
            statusLimitsReceived: true,
            useStickyPresentation: false,
        });
        expect(resolved.limits).toEqual({});
        expect(resolveControlUnits(resolved.limits).drum.unit).toBe('RPM');
    });

    it('keeps the last unit and range for the same machine while offline', () => {
        let cache = null;
        let resolved = resolveEffectiveControlLimits({
            cache,
            identity: machineA,
            statusLimits: limitsA,
            statusLimitsReceived: true,
            useStickyPresentation: false,
        });
        cache = resolved.cache;
        resolved = resolveEffectiveControlLimits({
            cache,
            identity: machineA,
            statusLimits: {},
            statusLimitsReceived: false,
            useStickyPresentation: true,
        });
        const axes = layoutControlAxes(
            { drum: true, heat: true, fan: true },
            resolveControlUnits(resolved.limits),
            0,
            100,
            { drum: [49, 50, 51] },
        );
        expect(axes.left.unit).toBe('%');
        expect(axes.left.min).toBe(0);
        expect(axes.left.max).toBe(100);
    });

    it('uses full-series extent for non-% change-label deadband span', () => {
        const units = resolveControlUnits({ drum: { min: 0, max: 500, unit: 'RPM' } });
        const span = deadbandSpanForChannel('drum', units, [40, 50, 60], { min: 49, max: 51 });
        expect(span.min).toBeLessThan(49);
        expect(span.max).toBeGreaterThan(51);
    });

    it('passes status limits through when machine identity is missing', () => {
        const live = { heater: { min: 0, max: 100, unit: '%' } };
        const resolved = resolveEffectiveControlLimits({
            cache: null,
            identity: null,
            statusLimits: live,
            statusLimitsReceived: true,
            useStickyPresentation: false,
        });
        expect(resolved.limits).toBe(live);
        expect(resolved.cache).toBeNull();
    });

    it('does not serve machine A sticky cache to machine B after identity change', () => {
        let cache = null;
        let resolved = resolveEffectiveControlLimits({
            cache,
            identity: machineA,
            statusLimits: limitsA,
            statusLimitsReceived: true,
            useStickyPresentation: false,
        });
        cache = resolved.cache;
        resolved = resolveEffectiveControlLimits({
            cache,
            identity: machineB,
            statusLimits: {},
            statusLimitsReceived: false,
            useStickyPresentation: true,
        });
        expect(resolved.cache?.identity).not.toBe(machineA);
        expect(resolved.limits).not.toEqual(limitsA);
        expect(resolved.limits?.drum).toBeUndefined();
    });

    it('clears leaked drum/fan when switching machine identity with live empty status', () => {
        let cache = null;
        let resolved = resolveEffectiveControlLimits({
            cache,
            identity: machineA,
            statusLimits: limitsA,
            statusLimitsReceived: true,
            useStickyPresentation: false,
        });
        cache = resolved.cache;
        resolved = resolveEffectiveControlLimits({
            cache,
            identity: machineB,
            statusLimits: {},
            statusLimitsReceived: true,
            useStickyPresentation: false,
        });
        expect(resolved.limits).toEqual({});
        expect(resolveControlUnits(resolved.limits).drum.unit).toBe('RPM');
    });
});
