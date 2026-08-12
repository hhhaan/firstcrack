export type {
    ControlCapability,
    ControlLimit,
    NetworkHost,
    PidCapability,
    PidRuntime,
    PidState,
    RoasterDef,
    RoasterFormField,
    RoastersResponse,
    SerialPort,
    SidecarStatus,
    TemperatureReading,
} from '@shared/types/sidecar';

/** Persisted machine config (app domain — not a sidecar DTO). */
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
