import { describe, expect, it } from 'vitest';
import { shouldMountMachineControl } from './shouldMountMachineControl';

const base = { entitled: true, pidState: 'off', writable: true, hasRoles: true };

describe('shouldMountMachineControl', () => {
    it('stays mounted on FAULT even when sidecar is gone', () => {
        expect(
            shouldMountMachineControl({
                ...base,
                pidState: 'fault',
                writable: false,
                hasRoles: false,
            }),
        ).toBe(true);
    });

    it('unmounts when disconnected and PID is off', () => {
        expect(shouldMountMachineControl({ ...base, writable: false, pidState: 'off' })).toBe(false);
    });

    it('stays mounted while PID is running even if plan entitlement flickers', () => {
        expect(shouldMountMachineControl({ ...base, entitled: false, pidState: 'running' })).toBe(true);
    });
});
