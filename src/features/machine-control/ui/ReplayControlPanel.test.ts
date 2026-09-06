import { describe, expect, it } from 'vitest';
import activeSrc from '../../../views/active-roast/ActiveRoast.tsx?raw';
import machineSrc from './MachineControlPanel.tsx?raw';
import panelSrc from './ReplayControlPanel.tsx?raw';

describe('Replay TSV error vs missing heater (#347)', () => {
    it('forwards isError to the panel and uses a distinct copy', () => {
        expect(activeSrc).toMatch(/isError:\s*replayCurveError/);
        expect(machineSrc).toMatch(/replayCurveError/);
        expect(panelSrc).toMatch(/curveError && !replay\.available/);
        expect(panelSrc).toContain("t('activeRoast.replay.curveLoadError')");
    });
});
