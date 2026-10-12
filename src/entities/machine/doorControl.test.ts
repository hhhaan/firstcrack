import { captureDoorSettingsPushFailure } from '@shared/lib/sentry';
import { SidecarHttpError, sidecar } from '@shared/lib/sidecar';
import { useToastStore } from '@shared/store/toast';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearMachineDoors, machineDoorControl, matchedDoorMachine, pushMachineDoors } from './doorControl';

vi.mock('@shared/lib/sidecar', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@shared/lib/sidecar')>();
    return { ...actual, sidecar: { ...actual.sidecar, updateSettings: vi.fn() } };
});
vi.mock('@shared/lib/sentry', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@shared/lib/sentry')>();
    return {
        ...actual,
        captureDoorSettingsPushFailure: vi.fn(actual.captureDoorSettingsPushFailure),
        isSentryEnabled: true,
    };
});
vi.mock('@shared/store/toast', () => ({ useToastStore: { getState: vi.fn() } }));

describe('machineDoorControl', () => {
    it('is only the shared W45A / W60A preset', () => {
        expect(machineDoorControl({ roasterKey: 'giesen_w45a_w60a' })).toBe(true);
        expect(machineDoorControl({ roasterKey: 'giesen_standard' })).toBe(false);
        expect(machineDoorControl({ roasterKey: 'giesen_w6a_pro' })).toBe(false);
    });
});

describe('matchedDoorMachine', () => {
    const w60 = { id: 'w60', roasterKey: 'giesen_w45a_w60a' };
    const other = { id: 'other', roasterKey: 'giesen_w6a_pro' };

    it('uses the connected door machine, or the only saved one when nothing is connected', () => {
        expect(matchedDoorMachine([other, w60], 'w60')).toBe(w60);
        expect(matchedDoorMachine([other, w60], 'other')).toBeUndefined();
        expect(matchedDoorMachine([other, w60], undefined)).toBeUndefined();
        expect(matchedDoorMachine([w60, { ...w60, id: 'w60-b' }], 'w60-b')).toEqual({ ...w60, id: 'w60-b' });
        expect(matchedDoorMachine([w60, { ...w60, id: 'w60-b' }], undefined)).toBeUndefined();
        expect(matchedDoorMachine([w60], 'missing')).toBeUndefined();
    });
});

describe('pushMachineDoors settings push', () => {
    const show = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(useToastStore.getState).mockReturnValue({ show } as unknown as ReturnType<
            typeof useToastStore.getState
        >);
        vi.mocked(sidecar.updateSettings).mockResolvedValue({ ok: true });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('captures once with door-control tags and no path in payload', async () => {
        const err = new SidecarHttpError('/settings', 503, 'host=10.0.0.2 down', false);
        vi.mocked(sidecar.updateSettings).mockRejectedValue(err);
        pushMachineDoors(
            { id: 'w60', roasterKey: 'giesen_w45a_w60a', dischargeDoor: true, fillDoor: false },
            { machine_id: 'w60', connection_epoch: 1 },
        );
        await Promise.resolve();
        expect(sidecar.updateSettings).toHaveBeenCalledWith(expect.any(Object), { reportErrors: false });
        expect(captureDoorSettingsPushFailure).toHaveBeenCalledOnce();
        expect(captureDoorSettingsPushFailure).toHaveBeenCalledWith(err);
        expect(show).toHaveBeenCalledWith('문 설정을 기기에 반영하지 못했습니다.', 'error');
        const blob = JSON.stringify(vi.mocked(captureDoorSettingsPushFailure).mock.calls[0]);
        expect(blob).not.toContain('10.0.0.2');
    });

    it('forwards settings push failures to the door-control capture helper (409 filtered inside)', async () => {
        const err = new SidecarHttpError('/settings', 409, 'wrong target', false);
        vi.mocked(sidecar.updateSettings).mockRejectedValue(err);
        pushMachineDoors(
            { id: 'w60', roasterKey: 'giesen_w45a_w60a', dischargeDoor: true, fillDoor: false },
            { machine_id: 'w60', connection_epoch: 1 },
        );
        await Promise.resolve();
        expect(captureDoorSettingsPushFailure).toHaveBeenCalledOnce();
        expect(captureDoorSettingsPushFailure).toHaveBeenCalledWith(err);
    });

    it('clearMachineDoors uses the same reporting path', async () => {
        vi.mocked(sidecar.updateSettings).mockRejectedValue(new SidecarHttpError('/settings', 'timeout', 't', false));
        clearMachineDoors({ machine_id: 'w60', connection_epoch: 2 });
        await Promise.resolve();
        expect(captureDoorSettingsPushFailure).toHaveBeenCalledOnce();
    });
});
