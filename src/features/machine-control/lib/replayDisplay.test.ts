import { describe, expect, it } from 'vitest';
import type { ReplayEvent } from './replay';
import { formatReplayCondition, formatReplayHeater } from './replayDisplay';

describe('formatReplayCondition', () => {
    const preTp: ReplayEvent = { t: 40, bt: 140, heater: 70 };
    const atTp: ReplayEvent = { t: 60, bt: 95, heater: 65 };
    const postTp: ReplayEvent = { t: 120, bt: 107.4, heater: 60 };

    it('TP 이전·동일 시각은 TIME mm:ss 이고 BT 온도를 쓰지 않는다', () => {
        expect(formatReplayCondition(preTp, 'time', 'C')).toBe('TIME 0:40');
        expect(formatReplayCondition(atTp, 'time', 'C')).toBe('TIME 1:00');
        expect(formatReplayCondition(preTp, 'time', 'C')).not.toContain('BT');
        expect(formatReplayCondition(preTp, 'time', 'F')).not.toContain('BT');
    });

    it('TP 이후는 BT 온도이고 원본 시각을 트리거처럼 보여 주지 않는다', () => {
        expect(formatReplayCondition(postTp, 'bt', 'C')).toBe('BT 107°C');
        expect(formatReplayCondition(postTp, 'bt', 'C')).not.toContain('TIME');
        expect(formatReplayCondition(postTp, 'bt', 'C')).not.toContain('2:00');
    });

    it('BT 표시는 선택 온도 단위를 따른다', () => {
        expect(formatReplayCondition({ t: 200, bt: 100, heater: 50 }, 'bt', 'F')).toBe('BT 212°F');
    });
});

describe('formatReplayHeater', () => {
    it('percent는 %로 표시한다', () => {
        expect(formatReplayHeater(70, '%')).toBe('70%');
    });

    it('native-step은 기기 단위를 붙인다', () => {
        expect(formatReplayHeater(7, 'step')).toBe('7step');
    });

    it('단위가 비면 %로 본다', () => {
        expect(formatReplayHeater(70)).toBe('70%');
        expect(formatReplayHeater(70, '')).toBe('70%');
    });
});
