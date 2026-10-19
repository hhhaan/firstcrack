// @vitest-environment jsdom
import { useGlobalDropShortcutStore } from '@shared/store/global-drop-shortcut';
import { useShortcutStore } from '@shared/store/keyboard-shortcuts';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { assert, expect, it, vi } from 'vitest';
import { KeyboardShortcutsModal } from './KeyboardShortcutsModal';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@shared/lib/settings-store', () => ({
    settingsGet: vi.fn(async () => undefined),
    settingsSet: vi.fn(async () => {}),
}));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it.each([false, true])('restores global Drop and shortcut defaults with other binding changes=%s', (changeBinding) => {
    useShortcutStore.getState().resetBindings();
    useGlobalDropShortcutStore.getState().setEnabled(true);
    if (changeBinding) useShortcutStore.getState().setBinding('yellow', 'mod+4');
    const root = createRoot(document.createElement('div'));
    try {
        act(() => root.render(createElement(KeyboardShortcutsModal)));
        const restore = [...document.querySelectorAll('button')].find(
            (button) => button.textContent === 'shortcuts.restore',
        );
        assert(restore);
        expect(restore.disabled).toBe(false);
        act(() => restore.click());
        expect(useGlobalDropShortcutStore.getState().enabled).toBe(false);
        expect(useShortcutStore.getState().bindings.yellow).toEqual(['mod+1']);
        expect(restore.disabled).toBe(true);
    } finally {
        act(() => root.unmount());
        useShortcutStore.getState().resetBindings();
        useGlobalDropShortcutStore.getState().setEnabled(false);
        localStorage.clear();
    }
});
it('reports an unsupported binding as soon as the option is switched on', () => {
    useGlobalDropShortcutStore.getState().setEnabled(false);
    const root = createRoot(document.createElement('div'));
    try {
        act(() => root.render(createElement(KeyboardShortcutsModal)));
        const label = [...document.querySelectorAll('label')].find(
            (element) => element.textContent === 'shortcuts.globalDrop',
        );
        const toggle = label?.querySelector('input');
        assert(toggle);
        act(() => toggle.click());
        expect(useGlobalDropShortcutStore.getState().enabled).toBe(true);
        expect(useGlobalDropShortcutStore.getState().status).toBe('unsupported');
        expect(document.querySelector('[role="status"]')?.textContent).toBe('shortcuts.globalDropStatus.unsupported');
    } finally {
        act(() => root.unmount());
        useGlobalDropShortcutStore.getState().setEnabled(false);
        localStorage.clear();
    }
});
