import { isCustomConnectKey, type RoasterDef } from '@entities/machine';
import type { MachineModalTab } from './types';

export type MachineFormMode = 'supported' | 'custom-new' | 'custom-edit';

export const machineFormMode = (input: {
    isEdit: boolean;
    tab: MachineModalTab;
    roasterKey?: string;
}): MachineFormMode => {
    if (input.isEdit) return input.roasterKey && isCustomConnectKey(input.roasterKey) ? 'custom-edit' : 'supported';
    return input.tab === 'custom' ? 'custom-new' : 'supported';
};

export const canCommitMachineForm = (input: {
    mode: MachineFormMode;
    selectedKey: string;
    selectedDef: RoasterDef | null;
    customName: string;
    customProtocol: string;
    connectKey: string;
}): boolean => {
    if (!input.selectedDef || !input.connectKey) return false;
    if (input.mode === 'supported') return Boolean(input.selectedKey);
    if (input.mode === 'custom-new') return Boolean(input.customName.trim() && input.customProtocol);
    return true;
};
