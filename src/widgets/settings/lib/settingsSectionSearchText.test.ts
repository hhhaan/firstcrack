// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { FORM_SELECT_KEYWORDS_ATTR, settingsSectionSearchText } from './settingsSectionSearchText';

describe('settingsSectionSearchText', () => {
    it('includes closed FormSelect option labels from data-form-select-keywords', () => {
        const section = document.createElement('section');
        section.textContent = 'Import from Firescope';
        const select = document.createElement('div');
        select.setAttribute(FORM_SELECT_KEYWORDS_ATTR, 'Firescope Artisan Cropster');
        section.append(select);

        const text = settingsSectionSearchText(section).toLocaleLowerCase();
        expect(text).toContain('artisan');
        expect(text).toContain('cropster');
        expect(text.includes('artisan') && text.includes('cropster')).toBe(true);
        expect(text.includes('korean')).toBe(false);
    });
});
