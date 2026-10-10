import type { PidRuntime } from '@entities/machine';
import type { CompletedRoastRestore } from '@features/active-roast/model/batch';
import { describe, expect, it } from 'vitest';
import {
    buildDropCancelControlMessage,
    dropCancelWarningFromRestore,
    shouldWarnDropCancelControl,
} from './drop-cancel-control';

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

const parts = {
    pidOff: 'PID off',
    heaterAt: (h: number) => `Heater ${h}%`,
    joiner: ' · ',
};

describe('shouldWarnDropCancelControl', () => {
    it('warns when PID was on before Drop and is off after cancel', () => {
        expect(shouldWarnDropCancelControl({ pidEngaged: true, pidSv: 215, heater: 70 }, pid('off'), 70)).toBe(true);
    });

    it('does not warn for small heater drift when PID is still on', () => {
        expect(shouldWarnDropCancelControl({ pidEngaged: true, pidSv: 215, heater: 70 }, pid('running', 215), 72)).toBe(
            false,
        );
    });

    it('warns when heater was on and is now 0', () => {
        expect(shouldWarnDropCancelControl({ pidEngaged: false, pidSv: null, heater: 70 }, null, 0)).toBe(true);
    });

    it('does not warn when heater stayed non-zero on hold', () => {
        expect(shouldWarnDropCancelControl({ pidEngaged: true, pidSv: 215, heater: 70 }, pid('off'), 45)).toBe(true);
    });
});

describe('buildDropCancelControlMessage', () => {
    it('shows PID off without implying heater 0 when hold kept duty', () => {
        expect(buildDropCancelControlMessage({ pidEngaged: true, pidSv: 215, heater: 70 }, pid('off'), 45, parts)).toBe(
            'PID off',
        );
    });

    it('shows actual heater percent when at zero', () => {
        expect(buildDropCancelControlMessage({ pidEngaged: false, pidSv: null, heater: 70 }, null, 0, parts)).toBe(
            'Heater 0%',
        );
    });
});

describe('dropCancelWarningFromRestore', () => {
    it('feeds cancel-drop banner state from restore snapshot', () => {
        const restore = {
            controlBeforeDrop: { pidEngaged: true, pidSv: 210, heater: 55 },
        } as CompletedRoastRestore;
        expect(dropCancelWarningFromRestore(restore)).toEqual({
            pidEngaged: true,
            pidSv: 210,
            heater: 55,
        });
    });
});
