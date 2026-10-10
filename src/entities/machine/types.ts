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
    importSource?: { product: 'Firescope' | 'Artisan' | 'Cropster'; sourceId: string | number };
}

/** Durable roast/profile copy of the machine used. Local id is not a FK. */
export interface MachineSnapshot {
    machine_id: string | null;
    machine_name: string | null;
    machine_roaster_key: string | null;
    machine_brand: string | null;
    machine_protocol: string | null;
}
