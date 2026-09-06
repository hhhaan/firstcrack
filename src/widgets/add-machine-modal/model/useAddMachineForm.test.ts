import { describe, expect, it } from 'vitest';
import formSrc from './useAddMachineForm.ts?raw';

describe('useAddMachineForm hook bus', () => {
    it('does not use a setter-injection sync hook', () => {
        expect(formSrc).not.toMatch(/useAddMachineFormSync/);
        expect(formSrc).not.toMatch(/useMachineFormActions/);
    });

    it('keys open reset on open + editingId', () => {
        expect(formSrc).toMatch(/\[open, editingId\]/);
    });

    it('shares validateOrError between commit and test', () => {
        expect(formSrc).toMatch(/validateOrError/);
        expect(formSrc.match(/validateOrError\(\)/g)?.length).toBeGreaterThanOrEqual(2);
        expect(formSrc).not.toMatch(/isCustom && !connectKey/);
    });
});
