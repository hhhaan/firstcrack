import { sidecar } from '@shared/lib/sidecar';
import type { Machine } from './types';

/** Classic W45A and W60A share this preset. Other machines have no door command. */
export const DOOR_ROASTER_KEY = 'giesen_w45a_w60a';

export const machineDoorControl = (machine: Pick<Machine, 'roasterKey'>) => machine.roasterKey === DOOR_ROASTER_KEY;

export const pushMachineDoors = (machine: Pick<Machine, 'roasterKey' | 'dischargeDoor' | 'fillDoor'>) => {
    const enabled = machineDoorControl(machine);
    void sidecar
        .updateSettings({
            w60a_discharge: enabled && machine.dischargeDoor === true,
            w60a_fill: enabled && machine.fillDoor === true,
        })
        .catch(() => {});
};
