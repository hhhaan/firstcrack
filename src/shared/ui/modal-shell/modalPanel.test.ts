import { describe, expect, it } from 'vitest';
import { chipCls, inputCls, labelCls, tabCls } from '../form-styles';
import { modalPanel } from './modalPanel';

describe('modalPanel + form-styles tokens', () => {
    it('exposes size keys used by form and confirm modals', () => {
        expect(Object.keys(modalPanel).sort()).toEqual(['formLg', 'formMd', 'formSm', 'settings', 'sm'].sort());
        for (const cls of Object.values(modalPanel)) {
            expect(cls.length).toBeGreaterThan(20);
            expect(cls).toMatch(/max-w-|rounded/);
        }
    });

    it('form field tokens are non-empty stable class strings', () => {
        expect(inputCls).toContain('rounded-xl');
        expect(labelCls).toContain('uppercase');
        expect(tabCls(true)).toContain('font-semibold');
        expect(tabCls(false)).toContain('bg-transparent');
        expect(chipCls(true)).toContain('border-primary');
        expect(chipCls(false)).toContain('border-black/10');
    });
});
