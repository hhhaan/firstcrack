import type { RoasterDef } from '@entities/machine';
import { describe, expect, it } from 'vitest';
import { canCommitMachineForm, machineFormMode } from './formMode';

const def = { display_name: 'X', protocol: 's7' } as RoasterDef;

describe('machineFormMode', () => {
    it('maps add tabs and custom edit separately from supported edit', () => {
        expect(machineFormMode({ isEdit: false, tab: 'supported' })).toBe('supported');
        expect(machineFormMode({ isEdit: false, tab: 'custom' })).toBe('custom-new');
        expect(machineFormMode({ isEdit: true, tab: 'supported', roasterKey: 'giesen_standard' })).toBe('supported');
        expect(machineFormMode({ isEdit: true, tab: 'supported', roasterKey: 'custom_s7' })).toBe('custom-edit');
    });
});

describe('canCommitMachineForm', () => {
    it('requires model for supported and name+protocol for custom-new', () => {
        expect(
            canCommitMachineForm({
                mode: 'supported',
                selectedKey: '',
                selectedDef: def,
                customName: '',
                customProtocol: '',
                connectKey: '',
            }),
        ).toBe(false);
        expect(
            canCommitMachineForm({
                mode: 'supported',
                selectedKey: 'giesen_standard',
                selectedDef: def,
                customName: '',
                customProtocol: '',
                connectKey: 'giesen_standard',
            }),
        ).toBe(true);
        expect(
            canCommitMachineForm({
                mode: 'custom-new',
                selectedKey: '',
                selectedDef: def,
                customName: '',
                customProtocol: 's7',
                connectKey: 'custom_s7',
            }),
        ).toBe(false);
        expect(
            canCommitMachineForm({
                mode: 'custom-new',
                selectedKey: '',
                selectedDef: def,
                customName: 'Shop',
                customProtocol: 's7',
                connectKey: 'custom_s7',
            }),
        ).toBe(true);
        expect(
            canCommitMachineForm({
                mode: 'custom-edit',
                selectedKey: 'custom_s7',
                selectedDef: def,
                customName: 'Shop',
                customProtocol: 's7',
                connectKey: 'custom_s7',
            }),
        ).toBe(true);
    });
});
