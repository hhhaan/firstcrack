/** Must match `data-form-select-keywords` on `@shared/ui/FormSelect`. */
export const FORM_SELECT_KEYWORDS_ATTR = 'data-form-select-keywords';

export function settingsSectionSearchText(section: HTMLElement, groupText = ''): string {
    const keywords = [...section.querySelectorAll(`[${FORM_SELECT_KEYWORDS_ATTR}]`)]
        .map((element) => element.getAttribute(FORM_SELECT_KEYWORDS_ATTR) ?? '')
        .join(' ');
    return `${groupText} ${keywords} ${section.textContent ?? ''}`.replace(/\s+/g, ' ').trim();
}

export function settingsSectionMatchesSearch(section: HTMLElement, terms: string[], groupText = ''): boolean {
    if (!terms.length) return true;
    const text = settingsSectionSearchText(section, groupText).toLocaleLowerCase();
    return terms.every((term) => text.includes(term));
}
