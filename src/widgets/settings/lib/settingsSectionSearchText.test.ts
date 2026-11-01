// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import {
    FORM_SELECT_KEYWORDS_ATTR,
    settingsSectionMatchesSearch,
    settingsSectionSearchText,
} from './settingsSectionSearchText';

describe('settingsSectionSearchText', () => {
    it('includes closed FormSelect option labels from data-form-select-keywords', () => {
        const section = document.createElement('section');
        section.textContent = 'Import from Firescope';
        const select = document.createElement('div');
        select.setAttribute(FORM_SELECT_KEYWORDS_ATTR, 'Firescope Artisan Cropster');
        section.append(select);

        expect(settingsSectionSearchText(section).toLocaleLowerCase()).toContain('artisan');
        expect(settingsSectionSearchText(section).toLocaleLowerCase()).toContain('cropster');
        expect(settingsSectionMatchesSearch(section, ['artisan'])).toBe(true);
        expect(settingsSectionMatchesSearch(section, ['cropster'])).toBe(true);
        expect(settingsSectionMatchesSearch(section, ['korean'])).toBe(false);
    });
});
