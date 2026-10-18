// @vitest-environment jsdom
import { inventoryStore } from '@shared/lib/inventoryStore';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GeneralSettingsTab } from './GeneralSettingsTab';

const { setTheme } = vi.hoisted(() => ({ setTheme: vi.fn() }));

vi.mock('@shared/store/theme', () => ({
    useThemeStore: (selector: (state: { theme: string; setTheme: typeof setTheme }) => unknown) =>
        selector({ theme: 'system', setTheme }),
}));

vi.mock('@shared/i18n', () => ({
    setLanguage: vi.fn(),
    supportedLanguages: [],
}));

vi.mock('@shared/lib/inventoryStore', () => ({
    inventoryStore: {
        getHorizonDays: vi.fn().mockResolvedValue(28),
        setHorizonDays: vi.fn(),
    },
}));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key, i18n: { resolvedLanguage: 'en' } }),
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// VOC: restore dark/system — un-skip with the settings theme picker.
describe.skip('GeneralSettingsTab theme picker', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        container = document.createElement('div');
        root = createRoot(container);
        setTheme.mockClear();
    });

    afterEach(() => root.unmount());

    it('shows three previews and selects the clicked theme', () => {
        act(() => root.render(createElement(GeneralSettingsTab)));

        const options = [...container.querySelectorAll<HTMLButtonElement>('[data-theme-option]')];
        expect(options).toHaveLength(3);
        expect(options.map((option) => option.dataset.themeOption)).toEqual(['light', 'dark', 'system']);
        expect(options[2]?.getAttribute('aria-pressed')).toBe('true');

        act(() => options[0]?.click());
        expect(setTheme).toHaveBeenCalledWith('light');
    });
});

describe('GeneralSettingsTab delayed inventory horizon', () => {
    let container: HTMLDivElement;
    let root: Root;
    let resolveRead: (days: number) => void;
    const input = () => container.querySelector('#settings-horizon') as HTMLInputElement;
    const change = (value: string) =>
        act(() => {
            const el = input();
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(el, value);
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
        });

    beforeEach(() => {
        vi.mocked(inventoryStore.getHorizonDays).mockReturnValue(
            new Promise((resolve) => {
                resolveRead = resolve;
            }),
        );
        vi.mocked(inventoryStore.setHorizonDays).mockClear();
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        act(() => root.render(createElement(GeneralSettingsTab)));
    });
    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    it('keeps the committed 30 when the initial read later returns 14', async () => {
        change('30');
        await act(async () => resolveRead(14));
        expect(input().value).toBe('30');
        expect(inventoryStore.setHorizonDays).toHaveBeenLastCalledWith(30);
        change('');
        act(() => input().dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
        expect(input().value).toBe('30');
    });

    it('initializes the saved value when there was no edit', async () => {
        await act(async () => resolveRead(14));
        expect(input().value).toBe('14');
        expect(inventoryStore.setHorizonDays).not.toHaveBeenCalled();
    });

    it('preserves a cleared draft during the initial load and restores the stored value on blur', async () => {
        change('99');
        change('');
        await act(async () => resolveRead(14));
        expect(input().value).toBe('');
        act(() => input().dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
        expect(input().value).toBe('14');
    });

    it('shows the stored value after an empty blur when the read finishes later', async () => {
        change('');
        act(() => input().dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
        expect(input().value).toBe('');
        await act(async () => resolveRead(45));
        expect(input().value).toBe('45');
    });

    it('keeps a typed value when the stored read finishes later', async () => {
        change('60');
        await act(async () => resolveRead(14));
        expect(input().value).toBe('60');
        expect(inventoryStore.setHorizonDays).toHaveBeenLastCalledWith(60);
    });

    it('commits only integers within 1–365', () => {
        change('30.7');
        expect(input().value).toBe('31');
        change('999');
        expect(input().value).toBe('365');
        change('0');
        expect(input().value).toBe('1');
    });
});
