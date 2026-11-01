// @vitest-environment jsdom

import { FormSelect } from '@shared/ui/FormSelect';
import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SettingsLayout } from './SettingsLayout';
import { SettingsSection } from './SettingsSection';
import type { SettingsTabId } from './tabConfig';

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string) => key,
        i18n: { resolvedLanguage: 'en' },
    }),
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const fillSearch = (input: HTMLInputElement, value: string) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
};

function ImportSectionHarness() {
    const [tab, setTab] = useState<SettingsTabId>('roast');
    return (
        <SettingsLayout activeTab={tab} onTabChange={setTab} onClose={() => undefined} initialRoastGroup="import">
            <SettingsSection group="import">
                <h2>Import settings</h2>
                <FormSelect value="Firescope" onChange={() => undefined} aria-label="Import from">
                    <option value="Firescope">Firescope</option>
                    <option value="Artisan">Artisan</option>
                    <option value="Cropster">Cropster</option>
                </FormSelect>
            </SettingsSection>
        </SettingsLayout>
    );
}

describe('SettingsLayout search with FormSelect', () => {
    let host: HTMLDivElement;
    let root: Root;

    afterEach(() => {
        act(() => root.unmount());
        host.remove();
    });

    it('finds a section when the query matches a closed FormSelect option label', () => {
        host = document.createElement('div');
        document.body.appendChild(host);
        root = createRoot(host);
        act(() => root.render(createElement(ImportSectionHarness)));

        const settings = host.querySelector('[data-testid="settings-page"]') as HTMLElement;
        const search = settings.querySelector('input[type="search"]') as HTMLInputElement;
        const section = settings.querySelector('[data-settings-section]') as HTMLElement;

        expect(section.hidden).toBe(false);

        act(() => fillSearch(search, 'Artisan'));

        expect(section.hidden).toBe(false);
        const empty = settings.querySelector('[role="status"]') as HTMLElement;
        expect(empty.hidden).toBe(true);
    });
});
