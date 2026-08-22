import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { chipCls, formErrorCls, inputCls, labelCls, tabCls } from '../form-styles';
import { modalPanel } from './modalPanel';

const here = dirname(fileURLToPath(import.meta.url));
const src = (rel: string) => readFileSync(join(here, rel), 'utf8');

describe('modalPanel + form-styles tokens', () => {
    it('exposes size keys used by form and confirm modals', () => {
        expect(Object.keys(modalPanel).sort()).toEqual(
            ['compare', 'formLg', 'formMd', 'formSm', 'settings', 'sm'].sort(),
        );
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
        expect(formErrorCls.length).toBeGreaterThan(8);
        expect(formErrorCls).toContain('text-red');
    });

    it('AddMachineModal and ProfileFormBody import ModalHeader', () => {
        expect(src('../../../widgets/add-machine-modal/ui/AddMachineModal.tsx')).toContain(
            "from '@shared/ui/modal-shell/ModalHeader'",
        );
        expect(src('../../../widgets/new-profile-modal/ui/ProfileFormBody.tsx')).toContain(
            "from '@shared/ui/modal-shell/ModalHeader'",
        );
    });

    it('ModalFooter is built from shared footer tokens', () => {
        const footer = src('./ModalFooter.tsx');
        expect(footer).toContain('modalFooterChrome');
        expect(footer).toContain('modalCancelBtnCls');
        expect(footer).toContain('modalPrimaryBtnCls');
    });
});
