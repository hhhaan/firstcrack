import { describe, expect, it } from 'vitest';
import panelSrc from './MachineControlPanel.tsx?raw';

describe('MachineControlPanel PID lifecycle (#269)', () => {
    it('PID 훅을 표시 가드보다 먼저 호출한다', () => {
        const hook = panelSrc.indexOf('usePidControl(');
        const guard = panelSrc.indexOf(
            'if (!pidActive && (!entitled || !writable || !anyWritableChannel)) return null',
        );
        expect(hook).toBeGreaterThan(-1);
        expect(guard).toBeGreaterThan(hook);
    });

    it('접힌 레일에 미반영 경고를 남긴다', () => {
        expect(panelSrc).toMatch(/collapsed && anyUnacknowledged/);
    });
});
