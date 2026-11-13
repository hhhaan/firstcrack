/** Must match `data-form-select-keywords` on `@shared/ui/FormSelect`. */
export const FORM_SELECT_KEYWORDS_ATTR = 'data-form-select-keywords';

export function settingsSectionSearchText(section: HTMLElement, groupText = ''): string {
    const keywords = [...section.querySelectorAll(`[${FORM_SELECT_KEYWORDS_ATTR}]`)]
        .map((element) => element.getAttribute(FORM_SELECT_KEYWORDS_ATTR) ?? '')
        .join(' ');
    return `${groupText} ${keywords} ${section.textContent ?? ''}`.replace(/\s+/g, ' ').trim();
}
