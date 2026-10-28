import type { StoredRoastEvent } from '@shared/types/roast';
import type { ExtraSensorReading, TemperatureProcessing } from '@shared/types/sidecar';

export interface BbpSample {
    bt: number;
    btRaw?: number | null;
    etRaw?: number | null;
    ror_et?: number | null;
    sensorTimestamp?: number | null;
    sensorClock?: string | null;
    processing?: TemperatureProcessing;
    et: number | null;
    heater: number | null;
    fan: number;
    drum: number;
    extraReadings?: ExtraSensorReading[];
}

export interface BbpPoint extends BbpSample {
    /** BBP 시작(End 확정) 기준 상대 초 */
    t: number;
}

export interface BbpSummary {
    seconds: number;
    chargeTemp: number | null;
}

export interface FinalizedBbp extends BbpSummary {
    /** 이 요약이 귀속되는 로스트 세션 — 저장 시 대조해 다른 세션 오염을 막는다 */
    sessionId: string;
    /** Charge-relative (negative) notes/heat written during this wait. */
    events?: StoredRoastEvent[];
}

export type BbpResult = BbpSummary & { tsv: string; events: StoredRoastEvent[] };
