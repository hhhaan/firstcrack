import type { PidRuntime } from '@entities/machine';
import { describe, expect, it } from 'vitest';
import { shouldWarnDropCancelControl } from './drop-cancel-control';

const pid = (state: PidRuntime['state'], sv = 200): PidRuntime => ({
    state,
    sv,
    duty: 50,
    pv: 190,
    p: 0,
    i: 0,
    d: 0,
    error: null,
});

describe('shouldWarnDropCancelControl', () => {
    it('warns when PID was on before Drop and is off after cancel', () => {
        expect(shouldWarnDropCancelControl({ pidEngaged: true, pidSv: 215, heater: 70 }, pid('off'), 70)).toBe(true);
    });

    it('warns when heater changed without PID', () => {
        expect(shouldWarnDropCancelControl({ pidEngaged: false, pidSv: null, heater: 70 }, null, 0)).toBe(true);
    });

    it('clears when PID and heater match pre-Drop state', () => {
        expect(shouldWarnDropCancelControl({ pidEngaged: true, pidSv: 215, heater: 70 }, pid('running', 215), 70)).toBe(
            false,
        );
    });
});
