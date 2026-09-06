import { describe, expect, it } from 'vitest';
import machinesSrc from '../Machines.tsx?raw';
import pageSrc from './useMachinesPageState.ts?raw';

describe('machines page state', () => {
    it('lives in the view, not the modal widget', () => {
        expect(machinesSrc).toMatch(/from '\.\/model\/useMachinesPageState'/);
        expect(machinesSrc).not.toMatch(/@widgets\/add-machine-modal\/model\/useMachinesPageState/);
        expect(pageSrc).not.toMatch(/@widgets\//);
    });

    it('passes modalOpen to the sidecar poll hook without a bridge state', () => {
        expect(machinesSrc).not.toMatch(/modalOpenForPoll/);
        expect(machinesSrc).toMatch(/modalOpen,/);
        expect(machinesSrc).toMatch(/useMachineSidecarConnection/);
    });
});
