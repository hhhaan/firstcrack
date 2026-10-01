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

it('locks bean change while roasting and unlocks it in standby', () => {
    useRoastingStore.setState({ phase: 'roasting' });
    const host = document.createElement('div');
    const root = createRoot(host);
    act(() => root.render(createElement(RoastHeader, props)));
    const beanSelect = host.querySelector('select') as HTMLSelectElement;
    expect(beanSelect.disabled).toBe(true);
    act(() => useRoastingStore.setState({ phase: 'standby' }));
    expect(beanSelect.disabled).toBe(false);
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
