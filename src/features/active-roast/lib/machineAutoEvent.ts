/** Loring Smart Roast Auto. Artisan input6 discrete 284, bit 0. */
export const LORING_SMART_ROAST_AUTO = 'loring_smart_roast_auto';

export type MachineAutoDecision = {
    event: 'charge' | 'drop' | null;
    /** Bit is high, so a BT dip must not start the batch. */
    suppressTemperatureCharge: boolean;
    /** Bit is high, so a BT dip must not end the batch. */
    suppressTemperatureDrop: boolean;
};

const IDLE: MachineAutoDecision = {
    event: null,
    suppressTemperatureCharge: false,
    suppressTemperatureDrop: false,
};

type Reading = { id: string; value: number | null };

/**
 * `undefined` — this payload has no auto_status channel.
 * `null` — the channel was not read this tick. Do not treat that as off.
 */
export const autoStatusFromReadings = (readings: Reading[] | undefined): number | null | undefined => {
    if (!readings) return undefined;
    const reading = readings.find((item) => item.id === 'auto_status');
    if (!reading) return undefined;
    return typeof reading.value === 'number' && Number.isFinite(reading.value) ? reading.value : null;
};

/**
 * Artisan Smart Roast Auto alarms, on the bit we read:
 * standby and bit > 0 → Charge. After that bit has been on, the fall to 0 → Drop.
 * A missing or unread sample holds the last bit. Temperature detection is the fallback
 * while the bit is off or the channel is absent.
 */
export const createMachineAutoDetector = () => {
    let last: number | null = null;

    const reset = () => {
        last = null;
    };

    const push = (input: {
        roasterKey: string | null | undefined;
        autoStatus: number | null | undefined;
        phase: string;
    }): MachineAutoDecision => {
        if (input.roasterKey !== LORING_SMART_ROAST_AUTO || input.autoStatus === undefined) return IDLE;
        if (input.autoStatus === null || !Number.isFinite(input.autoStatus)) {
            const high = last !== null && last > 0;
            return { event: null, suppressTemperatureCharge: high, suppressTemperatureDrop: high };
        }
        const high = input.autoStatus > 0;
        const fell = last !== null && last > 0 && !high;
        last = input.autoStatus;
        return {
            event: input.phase === 'standby' && high ? 'charge' : input.phase === 'roasting' && fell ? 'drop' : null,
            suppressTemperatureCharge: high,
            suppressTemperatureDrop: high,
        };
    };

    return { push, reset };
};
