import { formatElapsed } from '@shared/lib/format';
import type { ReplayEvent, ReplayTrigger } from './replay';

/** 표시만. 발화 분류는 eventTrigger. */
export const formatReplayCondition = (event: ReplayEvent, trigger: ReplayTrigger, tempUnit: 'C' | 'F'): string => {
    if (trigger === 'time') return `TIME ${formatElapsed(event.t)}`;
    const temp = Math.round(tempUnit === 'F' ? (event.bt * 9) / 5 + 32 : event.bt);
    return `BT ${temp}°${tempUnit}`;
};

export const formatReplayHeater = (heater: number, unit?: string): string => `${Math.round(heater)}${unit || '%'}`;
