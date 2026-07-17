import type { Machine, RoasterDef } from '@entities/machine';

export type CommitAction = 'add' | 'addAndConnect' | 'save' | 'saveAndConnect';
export type MachineModalTab = 'supported' | 'custom';
export type TestState = 'idle' | 'testing' | 'success' | 'failed';

export type AddMachineFormArgs = {
    open: boolean;
    onClose: () => void;
    onAdd: (
        roasterKey: string,
        def: RoasterDef,
        params: Record<string, unknown>,
        meta?: { name?: string; brand?: string },
    ) => void;
    editing?: Machine | null;
    onEdit?: (id: string, params: Record<string, unknown>, keepConnection?: boolean) => Promise<void>;
};

export type SuccessActions = {
    secondary: { action: CommitAction; label: string };
    primary: { action: CommitAction; label: string; loading: string };
};
