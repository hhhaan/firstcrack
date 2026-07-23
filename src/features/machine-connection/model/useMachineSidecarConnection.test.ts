/**
 * Structural + unit surface for CQ-R2 machine connection feature.
 * Poll/connect must live here (not in views/machines/Machines.tsx).
 */
import { describe, expect, it } from 'vitest';
import machinesSrc from '../../../views/machines/Machines.tsx?raw';
import hookSrc from './useMachineSidecarConnection.ts?raw';

describe('useMachineSidecarConnection', () => {
    it('owns sidecar poll interval (not the Machines view)', () => {
        expect(hookSrc).toMatch(/setInterval/);
        expect(hookSrc).toMatch(/sidecar\.getTemperatures|getTemperatures/);
        expect(hookSrc).toMatch(/sidecar\.connect|connect\(/);
        expect(machinesSrc).not.toMatch(/setInterval/);
        expect(machinesSrc).toMatch(/useMachineSidecarConnection/);
    });

    it('does not import other features (unidirectional features rule)', () => {
        expect(hookSrc).not.toMatch(/@features\/active-roast/);
    });
});
