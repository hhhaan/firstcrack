/** Sidecar HTTP protocol DTOs — owned by shared so infra clients need no entity imports. */

export interface SerialPort {
    device: string;
    description: string;
}

/** GET /scan-network item (Phase 1: host only). */
export interface NetworkHost {
    host: string;
}

// GET /roasters 응답
export interface RoasterFormField {
    key: string;
    label: string;
    type: 'text' | 'number' | 'select';
    required: boolean;
    placeholder?: string;
    options?: { value: string; label: string }[];
}

export interface RoasterDef {
    display_name: string;
    brand: string;
    models: string[];
    protocol: string;
    capabilities: string[];
    pid: { Kp: number; Ki: number; Kd: number } | null;
    form_fields: RoasterFormField[];
    default_params: Record<string, unknown>;
}

export type RoastersResponse = Record<string, RoasterDef>;

export type ReadUnits = Partial<Record<'heater' | 'fan' | 'drum', '%' | 'Pa' | 'Hz' | 'RPM'>>;

// GET /status 응답
/** 실제로 쓸 수 있는 채널의 클램프 범위. 사이드카 write_map에서 온다. */
export interface ControlLimit {
    min?: number;
    max?: number;
    unit?: string;
}

/**
 * 제어 가능 여부. 표시용 `capabilities`와 다르다 — capabilities는 "이 값을 읽어
 * 보여준다"는 뜻이고, 여기 writable은 "이 채널에 실제로 쓸 수 있다"는 뜻이다.
 */
export interface ControlCapability {
    writable: boolean;
    limits: Partial<Record<'heater' | 'fan' | 'drum', ControlLimit>>;
    pid?: PidCapability;
}

/** PID 지원 여부(정적). 게인과 heater 쓰기 맵이 둘 다 있어야 true. */
export interface PidCapability {
    supported: boolean;
    sv_min: number;
    sv_max: number;
}

/**
 * PID 런타임 상태. holding = 온도를 못 믿어 쓰기를 멈춘 상태(머신은 마지막 duty 유지),
 * fault = 안전 정지(사용자가 다시 켜야 해제).
 */
export type PidState = 'off' | 'running' | 'holding' | 'fault';

export interface PidRuntime {
    state: PidState;
    sv: number | null;
    duty: number | null;
    pv: number | null;
    p: number;
    i: number;
    d: number;
    error: string | null;
}

export interface ReplayHeaterTicket {
    readonly connection_epoch: number;
    readonly generation: number;
    readonly origin: 'replay';
}

export type HeaterControlIntent =
    | { origin: 'manual'; takeover: boolean; retry_epoch?: number }
    | (ReplayHeaterTicket & { retry_epoch?: number });

export interface SidecarStatus {
    machine_id?: string | null;
    connection_epoch?: number;
    heater_control?: {
        connection_epoch: number;
        generation: number;
        origin: 'manual' | 'replay' | 'pid' | 'safety';
        pending_writes: number;
        uncertain: boolean;
    };
    read_units?: ReadUnits;
    connected: boolean;
    reconnecting?: boolean;
    reconnect_attempt?: number;
    roaster: string;
    display_name: string;
    brand: string;
    capabilities: string[];
    control?: ControlCapability;
    uptime: number;
    error: string | null;
}

// GET /temperatures 응답
export interface TemperatureProcessing {
    /** Physical feedback units, independent of command limits. */
    read_units?: ReadUnits;
    algorithm_version: string;
    temperature_unit: 'C';
    ror_unit: 'C/min';
    timestamp_clock: 'sidecar-monotonic-seconds';
    display_ema_alpha: number;
    /** ET display EMA; old recordings use display_ema_alpha for both channels. */
    et_display_ema_alpha?: number;
    ror_ema_alpha: number;
    /** ET RoR EMA. Older recordings used ror_ema_alpha for both. */
    et_ror_ema_alpha?: number;
    ror_window_sec: number;
    ror_warmup_reads: number;
}

export interface ExtraSensorReading {
    id: string;
    label: string;
    unit: string;
    value: number | null;
}

export interface TemperatureReading {
    bt: number | null;
    /** Unsmoothed sensor BT for Charge detection; absent on older sidecars. */
    bt_raw?: number | null;
    et: number | null;
    /** Unsmoothed sensor ET for archive only. -1 means no ET channel. Absent on older sidecars. */
    et_raw?: number | null;
    ror: number;
    ror_et: number;
    heater: number | null;
    fan: number;
    drum: number;
    /** Read-only telemetry channels reported by the connected machine. */
    extra_readings?: ExtraSensorReading[];
    /** 사이드카가 이 연결에서 마지막으로 쓴 heater 세트포인트(수동·Replay·PID). 쓰기 전·쓰기 맵 없음·해제 후 null */
    heater_set?: number | null;
    timestamp: number;
    /** Sidecar instance and connection epoch. Changes across restarts/reconnects. */
    sensor_clock?: string;
    /** Actual sidecar calculation settings used for this sample. */
    processing?: TemperatureProcessing;
    /** 직전 read 실패로 이전 값을 유지 중인지 (사이드카 fail-open) */
    stale?: boolean;
    /** 백그라운드 자동 재연결 진행 중인지 */
    reconnecting?: boolean;
    /** PID를 한 번이라도 켠 뒤에만 실린다 */
    pid?: PidRuntime;
}
