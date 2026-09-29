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
