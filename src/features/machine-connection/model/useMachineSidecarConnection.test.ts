/**
 * FSD boundary: Machines view delegates sidecar polling to this feature hook.
 */
import { describe, expect, it } from 'vitest';
import machinesSrc from '../../../views/machines/Machines.tsx?raw';

describe('useMachineSidecarConnection', () => {
    it('does not poll from the Machines view (hook owns interval)', () => {
        expect(machinesSrc).not.toMatch(/setInterval/);
        expect(machinesSrc).toMatch(/useMachineSidecarConnection/);
    });
});
