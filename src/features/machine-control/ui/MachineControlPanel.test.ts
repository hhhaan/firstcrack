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

    it('수동·Replay 공용 commit 경로에서 0을 포함한 heater 값을 알린다', () => {
        expect(panelSrc).toMatch(/committed\.heater !== undefined/);
        expect(panelSrc).toMatch(/useMachineControl\(sidecarConnected, liveData, handleCommitted\)/);
        expect(panelSrc).toMatch(/heaterUnitRef\.current = limits\.heater\?\.unit \?\? '%'/);
        expect(panelSrc).toMatch(/onHeaterCommitted\?\.\(committed\.heater, heaterUnitRef\.current\)/);
    });

    it('A′ % 히터는 세로 눈금과 Fan/Drum 칩을 쓰고 sending… 문구는 없다', () => {
        expect(panelSrc).toMatch(/HeaterScale/);
        expect(panelSrc).toMatch(/ChannelChip/);
        expect(panelSrc).toMatch(/isPercentUnit\(limits\.heater\?\.unit\)/);
        expect(panelSrc).toMatch(/chipRoles\.length > 0/);
        expect(panelSrc).toMatch(/filter\(\(role\) => limits\[role\] != null\)/);
        expect(panelSrc).not.toMatch(/sending…/);
        expect(panelSrc).toMatch(/SetpointControl/);
        expect(panelSrc).toMatch(/sending && 'opacity-40'/);
    });

    it('Replay 이탈 허용치를 /status.control.limits.heater.max에서 받는다 (#428)', () => {
        expect(panelSrc).toMatch(/heaterMax:\s*limits\.heater\?\.max/);
    });
});
