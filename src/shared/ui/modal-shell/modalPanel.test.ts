import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { modalPanel } from './modalPanel';

const here = dirname(fileURLToPath(import.meta.url));
const src = (rel: string) => readFileSync(join(here, rel), 'utf8');

describe('modalPanel + form-styles tokens', () => {
    it('exposes size keys used by form and confirm modals', () => {
        expect(Object.keys(modalPanel).sort()).toEqual(
            ['compare', 'compareWorkspace', 'formLg', 'formMd', 'formSm', 'formXl', 'settings', 'sm'].sort(),
        );
        for (const cls of Object.values(modalPanel)) {
            expect(cls.length).toBeGreaterThan(20);
            expect(cls).toMatch(/max-w-|rounded/);
        }
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
