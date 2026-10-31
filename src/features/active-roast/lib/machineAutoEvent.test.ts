import { describe, expect, it } from 'vitest';
import { autoStatusFromReadings, createMachineAutoDetector, LORING_SMART_ROAST_AUTO } from './machineAutoEvent';

const push = (
    detector: ReturnType<typeof createMachineAutoDetector>,
    phase: string,
    autoStatus: number | null | undefined,
    roasterKey: string | null = LORING_SMART_ROAST_AUTO,
) => detector.push({ roasterKey, autoStatus, phase });

describe('Loring auto bit', () => {
    it('charges while standby once the bit is on, and drops on the fall', () => {
        const detector = createMachineAutoDetector();
        expect(push(detector, 'standby', 0).event).toBeNull();
        expect(push(detector, 'standby', 1)).toMatchObject({
            event: 'charge',
            suppressTemperatureCharge: true,
            suppressTemperatureDrop: true,
        });
        expect(push(detector, 'roasting', 1).event).toBeNull();
        expect(push(detector, 'roasting', null).suppressTemperatureDrop).toBe(true);
        expect(push(detector, 'roasting', 0).event).toBe('drop');
    });

    it('does not drop on a low bit that was never high', () => {
        const detector = createMachineAutoDetector();
        expect(push(detector, 'roasting', 0)).toEqual({
            event: null,
            suppressTemperatureCharge: false,
            suppressTemperatureDrop: false,
        });
    });

    it('ignores other machines and a payload with no auto channel', () => {
        const detector = createMachineAutoDetector();
        expect(push(detector, 'standby', 1, 'loring_smart_roast').event).toBeNull();
        expect(push(detector, 'standby', undefined).event).toBeNull();
        expect(push(detector, 'roasting', 0, 'giesen_w6a').suppressTemperatureDrop).toBe(false);
    });

    it('reads only a finite auto_status value', () => {
        expect(autoStatusFromReadings(undefined)).toBeUndefined();
        expect(autoStatusFromReadings([{ id: 'inlet', value: 180 }])).toBeUndefined();
        expect(autoStatusFromReadings([{ id: 'auto_status', value: null }])).toBeNull();
        expect(autoStatusFromReadings([{ id: 'auto_status', value: 1 }])).toBe(1);
    });
});
