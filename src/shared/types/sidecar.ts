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

export interface SidecarRecording {
    session_id: string;
    path: string;
}

export interface SidecarSessionStart {
    session_id: string;
    charge_epoch_ms: number;
    path?: string;
}

export interface SidecarStatus {
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
    recording?: SidecarRecording | null;
}

// GET /temperatures 응답
export interface TemperatureReading {
    bt: number | null;
    et: number | null;
    ror: number;
    ror_et: number;
    heater: number | null;
    fan: number;
    drum: number;
    timestamp: number;
    /** 직전 read 실패로 이전 값을 유지 중인지 (사이드카 fail-open) */
    stale?: boolean;
    /** 백그라운드 자동 재연결 진행 중인지 */
    reconnecting?: boolean;
    /** PID를 한 번이라도 켠 뒤에만 실린다 */
    pid?: PidRuntime;
}
