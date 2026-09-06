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

    it('does not Sentry-capture opaque sidecar-down errors (FC-16)', () => {
        expect(hookSrc).toMatch(/isOpaqueNetworkError/);
        expect(hookSrc).toMatch(/logger\.capture/);
    });

    it('waits for authenticated sidecar readiness', () => {
        expect(hookSrc).toContain("listen<null>('sidecar-ready'");
        expect(hookSrc).toContain('sidecar.waitUntilReady()');
        expect(hookSrc).toContain('sidecarReady');
        expect(machinesSrc).toMatch(/disabled=\{connecting \|\| !sidecarReady\}/);
        expect(machinesSrc).toContain("t('machines.sidecarStarting')");
    });
});
