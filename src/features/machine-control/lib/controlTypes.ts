export type ControlRole = 'heater' | 'fan' | 'drum';
export type ControlCommand = Partial<Record<ControlRole, number>>;

export interface ControlRetry {
    connectionEpoch: number;
}
