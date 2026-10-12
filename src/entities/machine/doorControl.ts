import { captureDoorSettingsPushFailure } from '@shared/lib/sentry';
import { sidecar } from '@shared/lib/sidecar';
import { useToastStore } from '@shared/store/toast';
import type { SidecarStatus } from '@shared/types/sidecar';
import type { Machine } from './types';

/** Classic W45A and W60A share this preset. Other machines have no door command. */
export const DOOR_ROASTER_KEY = 'giesen_w45a_w60a';
export const machineDoorControl = (machine: Pick<Machine, 'roasterKey'>) => machine.roasterKey === DOOR_ROASTER_KEY;

/** A saved device must match the live connection; never infer another same-key machine. */
export const matchedDoorMachine = <T extends Pick<Machine, 'id' | 'roasterKey'>>(
    machines: readonly T[],
    machineId: string | null | undefined,
): T | undefined => machines.find((item) => item.id === machineId && machineDoorControl(item));

export const pushMachineDoors = (
    machine: Pick<Machine, 'id' | 'roasterKey' | 'dischargeDoor' | 'fillDoor'>,
    status: Pick<SidecarStatus, 'machine_id' | 'connection_epoch'>,
) => {
    const enabled = machineDoorControl(machine) && machine.id === status.machine_id;
    pushDoorSettings({
        machine_id: status.machine_id,
        connection_epoch: status.connection_epoch,
        w60a_discharge: enabled && machine.dischargeDoor === true,
        w60a_fill: enabled && machine.fillDoor === true,
    });
};

export const clearMachineDoors = (status: Pick<SidecarStatus, 'machine_id' | 'connection_epoch'>) => {
    pushDoorSettings({
        machine_id: status.machine_id,
        connection_epoch: status.connection_epoch,
        w60a_discharge: false,
        w60a_fill: false,
    });
};

const pushDoorSettings = (settings: Record<string, unknown>) => {
    void sidecar.updateSettings(settings, { reportErrors: false }).catch((error) => {
        captureDoorSettingsPushFailure(error);
        useToastStore.getState().show('문 설정을 기기에 반영하지 못했습니다.', 'error');
    });
};
