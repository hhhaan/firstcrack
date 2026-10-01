import type { TemperatureProcessing } from './sidecar';
/** Manual observations only; never sent as machine control commands. */
export type RoastNoteControls = {
    gas?: string;
    airflow?: string;
};

/** Live roast event log row (UI + in-memory). */
export interface LogEntry extends RoastNoteControls {
    id?: string;
    /** Display "m:ss" (derived). */
    time: string;
    /** Charge-relative seconds — preferred for persist / chart. */
    timeSec?: number;
    event: string;
    /** Display temperature string. */
    temp: string;
    /** Raw BT °C at event time — preferred for persist. */
    tempC?: number | null;
    note: string;
    current?: boolean;
    chartLabel?: string;
    color?: string;
}

/** Persisted on roast_sessions.events jsonb. */
export type StoredRoastEvent = RoastNoteControls & {
    id: string;
    type: string;
    time_sec: number;
    temp_c?: number | null;
    note?: string | null;
};

export interface LiveRoastPoint {
    time: number;
    label: string;
    bt: number;
    et: number | null;
    ror: number | null;
    ror_et: number | null;
    /** null = 화력 피드백 채널 없음 — TSV에는 빈칸으로 남는다 */
    heater: number | null;
    fan: number;
    drum: number;
    /** 사이드카가 마지막으로 쓴 heater 세트포인트. 열이 생기기 전 기록·쓰기 맵 없는 머신에는 없다 */
    heaterSet?: number | null;
    /** 평활화 전 ET. 차트는 `et`를 쓴다 */
    etRaw?: number | null;
    /** 평활화 전 BT. 차트는 `bt`를 쓴다 */
    btRaw?: number | null;
    sensorTimestamp?: number | null;
    sensorClock?: string | null;
    processing?: TemperatureProcessing;
}
