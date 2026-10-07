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

/** A collected roast sample. Survives view recovery with the active session. */
export interface LiveRoastPoint {
    time: number;
    label: string;
    bt: number;
    et: number | null;
    ror: number | null;
    ror_et: number | null;
    /** null = no heater feedback channel; TSV stores a blank cell. */
    heater: number | null;
    fan: number;
    drum: number;
    /** Last heater setpoint written by the sidecar, when supported. */
    heaterSet?: number | null;
    /** IKAWA profile setpoint °C. Live chart only — not a TSV column. */
    setpoint?: number | null;
    /** Unsmoothed ET for the archive; charts use `et`. */
    etRaw?: number | null;
    /** Unsmoothed BT for the archive; charts use `bt`. */
    btRaw?: number | null;
    sensorTimestamp?: number | null;
    sensorClock?: string | null;
    processing?: TemperatureProcessing;
}
