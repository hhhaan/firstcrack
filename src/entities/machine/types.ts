export interface SerialPort {
    device: string;
    description: string;
}

/** GET /scan-network item (Phase 1: host only). */
export interface NetworkHost {
    host: string;
}

export interface Machine {
    id: string;
    name: string;
    roasterKey: string;
    displayName: string;
    brand: string;
    models: string[];
    protocol: string;
    connectionParams: Record<string, unknown>;
    capabilities: string[];
    pid: { Kp: number; Ki: number; Kd: number } | null;
    createdAt: string;
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
}

// GET /temperatures 응답
export interface TemperatureReading {
    bt: number | null;
    et: number | null;
    ror: number;
    ror_et: number;
    heater: number;
    fan: number;
    drum: number;
    timestamp: number;
    /** 직전 read 실패로 이전 값을 유지 중인지 (사이드카 fail-open) */
    stale?: boolean;
    /** 백그라운드 자동 재연결 진행 중인지 */
    reconnecting?: boolean;
}
