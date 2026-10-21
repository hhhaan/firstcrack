// @vitest-environment jsdom
import { useRoastingStore } from '@features/active-roast/model/status';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { RoastHeader } from './RoastHeader';

vi.mock('@entities/blend', () => ({ useBlends: () => ({ data: [{ id: 'blend-1', name: 'Modern' }] }) }));

vi.mock('@entities/bean/queries', () => ({
    useBeans: () => ({
        data: [{ id: 'bean-1', name: 'Santander Cooperative', origin: 'Colombia', region: 'Santander' }],
    }),
}));

vi.mock('@features/active-roast/model/useBatchNumber', () => ({ useBatchNumber: () => 1 }));

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
    document.body.replaceChildren();
});

const click = (element: Element | null | undefined) => {
    act(() => {
        element?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
};

const targetButton = () => document.querySelector('button[aria-label="activeRoast.header.target"]');

const buttonNamed = (text: string) =>
    [...document.querySelectorAll('button')].find((button) => button.textContent?.includes(text));

const props = {
    phase: 'roasting',
    targetProfileId: null,
    selectedBeanId: null,
    onTargetProfileChange: () => {},
    onBeanChange: () => {},
};

it.each([
    { targetProfileId: null, historyReferenceName: null },
    { targetProfileId: 'missing', historyReferenceName: null },
    { targetProfileId: 'prof-1', historyReferenceName: null },
    { targetProfileId: null, historyReferenceName: 'Reference roast' },
])('uses the bean heading for the editable title instead of the target: %j', (target) => {
    const state = useRoastingStore.getState();
    state.prepareWorkspace('user-1');
    state.prepareBean('bean-1');
    const host = document.createElement('div');
    const root = createRoot(host);
    act(() => root.render(createElement(RoastHeader, { ...props, ...target, selectedBeanId: 'bean-1' })));
    act(() => {
        const id = state.startCharge(undefined, 'user-1') ?? '';
        state.assignBatchNumbers(id, 'user-1', 3, 10, 'profile');
    });
    expect(host.querySelector('input')?.value).toBe('Colombia Santander #3');
    expect(host.querySelector('[title="activeRoast.header.batchNumberHint"]')).toBeNull();
    act(() => root.unmount());
});

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
    document.body.append(host);
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
    click(targetButton());
    click(buttonNamed('Two'));
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

it('keeps the target list on the profile while a history background is active', () => {
    const onTargetProfileChange = vi.fn();
    const onClearHistoryReference = vi.fn();
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    act(() =>
        root.render(
            createElement(RoastHeader, {
                ...props,
                targetProfileId: 'prof-1',
                historyReferenceName: 'Reference roast · 26-10-12',
                onTargetProfileChange,
                onChooseHistoryReference: () => {},
                onClearHistoryReference,
            }),
        ),
    );
    const trigger = targetButton();
    expect(trigger?.textContent).toContain('Reference roast · 26-10-12');
    expect(trigger?.textContent).not.toContain('One');
    click(trigger);
    expect(buttonNamed('activeRoast.reference.choose')).toBeDefined();
    const profileItem = [...document.querySelectorAll('button')].find(
        (button) => button !== trigger && button.textContent?.includes('One'),
    );
    click(profileItem);
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

it('shows a grouped blend option and selects the recipe independently of beans', () => {
    const onBlendChange = vi.fn();
    const host = document.createElement('div');
    const root = createRoot(host);
    act(() => root.render(createElement(RoastHeader, { ...props, selectedBlendId: 'blend-1', onBlendChange })));
    const select = host.querySelector('select');
    expect(select?.value).toBe('blend:blend-1');
    expect(host.textContent).toContain('Modern');
    act(() => select?.dispatchEvent(new Event('change', { bubbles: true })));
    expect(onBlendChange).toHaveBeenCalledWith('blend-1', 'Modern');
    act(() => root.unmount());
});
