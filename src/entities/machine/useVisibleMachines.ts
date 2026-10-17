import { FEATURE, useFeature } from '@shared/lib/features';
import { useMemo } from 'react';
import { machinesForPicker, useMachines } from './model';
import type { Machine } from './types';

/** Registered machines, minus the virtual roaster unless this account's flag is on. */
export function useVisibleMachines(): Machine[] {
    const machines = useMachines((state) => state.machines);
    const simulatorEnabled = useFeature(FEATURE.simulator);
    return useMemo(() => machinesForPicker(machines, simulatorEnabled), [machines, simulatorEnabled]);
}
