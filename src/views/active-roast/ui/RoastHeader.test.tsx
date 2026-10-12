// @vitest-environment jsdom
import { useRoastingStore } from '@features/active-roast/model/status';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { RoastHeader } from './RoastHeader';

vi.mock('@entities/bean/queries', () => ({
    useBeans: () => ({ data: [] }),
}));

vi.mock('@entities/organization', () => ({
    useActiveWorkspace: () => ({ workspaceOwnerId: 'user-1' }),
}));

const profileMutate = vi.hoisted(() => vi.fn());

vi.mock('@entities/profile', () => ({
    useProfile: () => ({ data: { default_roast_profile_id: 'prof-1' } }),
    useUpdateProfile: () => ({ mutate: profileMutate }),
}));

vi.mock('@entities/roast-profile', () => ({
    useRoastProfiles: () => ({
        data: [
            { id: 'prof-1', name: 'One' },
            { id: 'prof-2', name: 'Two' },
        ],
    }),
}));

vi.mock('@shared/store/auth', () => ({
    useAuthStore: (sel: (s: { user: null }) => unknown) => sel({ user: null }),
}));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key }),
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
    useRoastingStore.getState().reset();
});

const props = {
    phase: 'roasting',
    targetProfileId: null,
    selectedBeanId: null,
    onTargetProfileChange: () => {},
    onBeanChange: () => {},
};

it('renders reconnecting status when store.reconnecting is true', () => {
    useRoastingStore.setState({ reconnecting: true });
    const host = document.createElement('div');
    const root = createRoot(host);
    act(() => root.render(createElement(RoastHeader, props)));
    const status = host.querySelector('[role="status"]');
    expect(status).not.toBeNull();
    expect(status?.getAttribute('aria-live')).toBe('assertive');
    expect(status?.textContent).toBe('activeRoast.header.reconnecting');
    act(() => root.unmount());
});

it('delegates a profile change and does not save the account default', () => {
    vi.useFakeTimers();
    profileMutate.mockClear();
    const onTargetProfileChange = vi.fn();
    const host = document.createElement('div');
    const root = createRoot(host);
    act(() =>
        root.render(
            createElement(RoastHeader, {
                ...props,
                targetProfileId: 'prof-1',
                onTargetProfileChange,
            }),
        ),
    );
    const profileSelect = host.querySelectorAll('select')[1] as HTMLSelectElement;
    act(() => {
        profileSelect.value = 'prof-2';
        profileSelect.dispatchEvent(new Event('change', { bubbles: true }));
    });
    act(() => {
        vi.advanceTimersByTime(300);
    });
    expect(onTargetProfileChange).toHaveBeenCalledWith('prof-2');
    expect(profileMutate).not.toHaveBeenCalled();
    act(() => root.unmount());
    vi.useRealTimers();
});

it('locks bean change while roasting or ended and unlocks it in standby', () => {
    useRoastingStore.setState({ phase: 'roasting' });
    const host = document.createElement('div');
    const root = createRoot(host);
    act(() => root.render(createElement(RoastHeader, props)));
    const beanSelect = host.querySelector('select') as HTMLSelectElement;
    expect(beanSelect.disabled).toBe(true);
    act(() => useRoastingStore.setState({ phase: 'ended' }));
    expect(beanSelect.disabled).toBe(true);
    act(() => useRoastingStore.setState({ phase: 'standby' }));
    expect(beanSelect.disabled).toBe(false);
    act(() => root.unmount());
});

it('opens a history background from the target select without changing the profile', () => {
    const onTargetProfileChange = vi.fn();
    const onChooseHistoryReference = vi.fn();
    const host = document.createElement('div');
    const root = createRoot(host);
    act(() =>
        root.render(
            createElement(RoastHeader, {
                ...props,
                targetProfileId: 'prof-1',
                onTargetProfileChange,
                onChooseHistoryReference,
            }),
        ),
    );
    const profileSelect = host.querySelectorAll('select')[1] as HTMLSelectElement;
    const choose = [...profileSelect.options].find((option) => option.textContent === 'activeRoast.reference.choose');
    act(() => {
        profileSelect.value = choose?.value ?? '';
        profileSelect.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(onChooseHistoryReference).toHaveBeenCalledOnce();
    expect(onTargetProfileChange).not.toHaveBeenCalled();
    expect(profileSelect.value).toBe('prof-1');
    act(() => root.unmount());
});

it('shows a history roast as the target and returns to the profile from the same select', () => {
    const onTargetProfileChange = vi.fn();
    const onClearHistoryReference = vi.fn();
    const host = document.createElement('div');
    const root = createRoot(host);
    act(() =>
        root.render(
            createElement(RoastHeader, {
                ...props,
                targetProfileId: 'prof-1',
                historyReferenceName: 'Reference roast',
                onTargetProfileChange,
                onChooseHistoryReference: () => {},
                onClearHistoryReference,
            }),
        ),
    );
    const profileSelect = host.querySelectorAll('select')[1] as HTMLSelectElement;
    expect(profileSelect.selectedOptions[0]?.textContent).toBe('Reference roast');
    const clear = [...profileSelect.options].find((option) => option.textContent === 'activeRoast.reference.clear');
    act(() => {
        profileSelect.value = clear?.value ?? '';
        profileSelect.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(onClearHistoryReference).toHaveBeenCalledOnce();
    expect(onTargetProfileChange).not.toHaveBeenCalled();
    act(() => root.unmount());
});

it('hides reconnecting status when store.reconnecting is false', () => {
    useRoastingStore.setState({ reconnecting: false });
    const host = document.createElement('div');
    const root = createRoot(host);
    act(() => root.render(createElement(RoastHeader, props)));
    expect(host.querySelector('[role="status"]')).toBeNull();
    act(() => root.unmount());
});
