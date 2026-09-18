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

    it('R04 관측 품질을 Replay에 사실로 넘긴다 (R05)', () => {
        expect(panelSrc).toMatch(/observationQuality: ObservationQuality/);
        expect(panelSrc).toMatch(/observationQuality,/);
    });

    it('R06 last-valid 나이와 nowMs를 Replay에 넘긴다', () => {
        expect(panelSrc).toMatch(/lastValidReceivedAtMs/);
        expect(panelSrc).toMatch(/nowMs/);
    });

    it('Replay active/stop을 상위에 노출하고 훅을 두 번 만들지 않는다', () => {
        expect(panelSrc).toMatch(/onReplayControl/);
        expect(panelSrc.match(/useReplayControl\(/g)?.length).toBe(1);
    });

    it('접힌 레일은 무효 관측 보류를 정상 재생과 구분한다 (R05)', () => {
        expect(panelSrc).toMatch(/replay\.observationHold/);
        expect(panelSrc).toMatch(/REPLAY_OBSERVATION_HOLD_TEXT/);
    });

    it('Replay 다음 이벤트에 기기 heater 단위를 넘긴다', () => {
        expect(panelSrc).toMatch(/heaterUnit=\{limits\.heater\?\.unit/);
    });

    it('접힌 Replay 점은 TP 대기/폴백을 정상 재생과 구분한다', () => {
        expect(panelSrc).toMatch(/collapsedReplayTpChrome/);
        expect(panelSrc).toMatch(/replayChrome === 'running'[\s\S]*?bg-emerald-500/);
        expect(panelSrc).toMatch(/isReplayTpHold\(replayChrome\)[\s\S]*?bg-amber-500/);
        expect(panelSrc).not.toMatch(/collapsed && replay\.active &&/);
    });

    it('Replay 패널에서 화력 편집 모달을 연다 (#435)', () => {
        expect(panelSrc).toMatch(/HeaterEventsEditor/);
        expect(panelSrc).toMatch(/onEditHeat/);
        expect(panelSrc).toMatch(/applyBatchEvents/);
        expect(panelSrc).toMatch(/profileHeaterEvents:\s*replayHeaterEvents/);
    });
});
