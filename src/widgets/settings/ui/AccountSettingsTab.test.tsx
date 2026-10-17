// @vitest-environment jsdom
import { locationStore, parseLocationString } from '@shared/lib/locationStore';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountSettingsTab } from './AccountSettingsTab';

const mocks = vi.hoisted(() => ({
    mutateAsync: vi.fn(),
    invalidateQueries: vi.fn(),
    profile: {
        display_name: '한승헌',
        business_name: null as string | null,
        business_registration_number: null as string | null,
    },
}));

vi.mock('@entities/profile', async () => {
    const actual = await vi.importActual<typeof import('@entities/profile')>('@entities/profile');
    return {
        ...actual,
        useProfile: () => ({ data: mocks.profile }),
        useUpdateProfile: () => ({ mutateAsync: mocks.mutateAsync, isPending: false }),
    };
});

vi.mock('@shared/lib/locationStore', () => ({
    locationStore: { get: vi.fn().mockResolvedValue(null), set: vi.fn() },
    parseLocationString: vi.fn().mockReturnValue(null),
}));

vi.mock('@shared/lib/logger', () => ({ logger: { capture: vi.fn() } }));

vi.mock('@shared/store/auth', () => ({
    useAuthStore: (
        selector: (state: { user: { id: string; email: string }; signOut: () => Promise<void> }) => unknown,
    ) => selector({ user: { id: 'u1', email: 'han@example.com' }, signOut: vi.fn() }),
}));

vi.mock('@tanstack/react-query', () => ({
    useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
}));

vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn() }));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key }),
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const setInputValue = (input: HTMLInputElement, value: string) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
};

describe('AccountSettingsTab display name', () => {
    let container: HTMLDivElement;
    let root: Root;

    const displayNameInput = () => container.querySelectorAll('input:not([readonly])')[0] as HTMLInputElement;
    const saveButton = () =>
        [...container.querySelectorAll('button')].find(
            (el) => el.textContent === 'settings.tabs.account.saveChanges',
        ) as HTMLButtonElement;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        mocks.mutateAsync.mockReset();
        mocks.mutateAsync.mockResolvedValue({});
        mocks.profile.display_name = '한승헌';
        mocks.profile.business_name = null;
        mocks.profile.business_registration_number = null;
        act(() => root.render(createElement(AccountSettingsTab, { onClose: () => {} })));
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    it('rejects an empty or whitespace-only display name', async () => {
        expect(displayNameInput().value).toBe('한승헌');
        expect(saveButton().disabled).toBe(false);
        expect(container.textContent).not.toContain('settings.tabs.account.displayNameRequired');

        act(() => setInputValue(displayNameInput(), ''));
        expect(saveButton().disabled).toBe(true);
        expect(container.textContent).toContain('settings.tabs.account.displayNameRequired');

        await act(async () => saveButton().click());
        expect(mocks.mutateAsync).not.toHaveBeenCalled();

        act(() => setInputValue(displayNameInput(), '   '));
        expect(saveButton().disabled).toBe(true);
        expect(container.textContent).toContain('settings.tabs.account.displayNameRequired');

        await act(async () => saveButton().click());
        expect(mocks.mutateAsync).not.toHaveBeenCalled();
    });

    it('saves a trimmed non-empty display name', async () => {
        act(() => setInputValue(displayNameInput(), '  Ada Lovelace  '));
        expect(saveButton().disabled).toBe(false);
        expect(container.textContent).not.toContain('settings.tabs.account.displayNameRequired');

        await act(async () => saveButton().click());
        expect(mocks.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ display_name: 'Ada Lovelace' }));
    });
    it('keeps all edited fields when an unrelated profile cache update arrives', async () => {
        act(() => {
            setInputValue(displayNameInput(), 'Draft');
            setInputValue(container.querySelector('#account-business-name') as HTMLInputElement, 'Roastery');
            setInputValue(container.querySelector('#account-business-reg') as HTMLInputElement, '123');
            setInputValue(container.querySelector('#account-location') as HTMLInputElement, '37, 127');
        });
        mocks.profile = { ...mocks.profile };
        act(() => root.render(createElement(AccountSettingsTab, { onClose: () => {} })));
        expect(displayNameInput().value).toBe('Draft');
        vi.mocked(parseLocationString).mockReturnValueOnce({ lat: 37, lng: 127 });
        await act(async () => saveButton().click());
        expect(mocks.mutateAsync).toHaveBeenCalledWith({
            display_name: 'Draft',
            business_name: 'Roastery',
            business_registration_number: '123',
        });
        expect(locationStore.set).toHaveBeenCalledWith({ lat: 37, lng: 127 });
    });

    it('clears pristine fields when the cached server values become empty', () => {
        mocks.profile = { ...mocks.profile, display_name: '', business_name: null };
        act(() => root.render(createElement(AccountSettingsTab, { onClose: () => {} })));
        expect(displayNameInput().value).toBe('');
    });

    it('does not overwrite coordinates typed before a delayed location read resolves', async () => {
        act(() => root.unmount());
        let resolveRead!: (value: { lat: number; lng: number }) => void;
        vi.mocked(locationStore.get).mockReturnValueOnce(
            new Promise((resolve) => {
                resolveRead = resolve;
            }),
        );
        root = createRoot(container);
        act(() => root.render(createElement(AccountSettingsTab, { onClose: () => {} })));
        act(() => setInputValue(container.querySelector('#account-location') as HTMLInputElement, '37, 127'));
        await act(async () => resolveRead({ lat: 1, lng: 2 }));
        expect(container.querySelector<HTMLInputElement>('#account-location')?.value).toBe('37, 127');
    });
});
