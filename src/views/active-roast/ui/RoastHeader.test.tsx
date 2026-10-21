// @vitest-environment jsdom
import { useRoastingStore } from '@features/active-roast/model/status';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RoastHeader } from './RoastHeader';

vi.mock('@entities/blend', () => ({ useBlends: () => ({ data: [{ id: 'blend-1', name: 'Modern' }] }) }));

vi.mock('@entities/bean/queries', () => ({
    useBeans: () => ({
        data: [
            { id: 'bean-1', name: 'Santander Cooperative', origin: 'Colombia', region: 'Santander' },
            { id: 'bean-2', name: '마라닉', origin: null, region: null },
        ],
    }),
}));

vi.mock('@features/active-roast/model/useBatchNumber', () => ({ useBatchNumber: () => 1 }));

vi.mock('@entities/organization', () => ({
    useActiveWorkspace: () => ({ workspaceOwnerId: 'user-1', isWorkspaceReady: true }),
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
])('shows the automatic batch title in the existing heading: %j', (target) => {
    const state = useRoastingStore.getState();
    state.prepareWorkspace('user-1');
    state.prepareBean('bean-1');
    const host = document.createElement('div');
    const root = createRoot(host);
    act(() => root.render(createElement(RoastHeader, { ...props, ...target, selectedBeanId: 'bean-1' })));
    expect(host.querySelector('span')?.textContent).toBe('Colombia Santander');
    act(() => {
        const id = state.startCharge(undefined, 'user-1') ?? '';
        state.assignBatchNumbers(id, 'user-1', 3, 10, 'profile');
    });
    expect(useRoastingStore.getState().activeSelection?.identity?.title).toBe('Colombia Santander #3');
    expect(host.querySelector('input')).toBeNull();
    expect(host.querySelector('label')).toBeNull();
    expect(host.textContent).not.toContain('activeRoast.header.batchTitle');
    expect(host.querySelector('span')?.textContent).toBe('Colombia Santander #3');
    expect(host.querySelector('select')?.disabled).toBe(false);
    expect(host.querySelector('[title="activeRoast.header.batchNumberHint"]')).toBeNull();
    act(() => root.unmount());
});

it.each([
    { selectedBeanId: 'bean-2', selectedBlendId: null, name: '마라닉' },
    { selectedBeanId: null, selectedBlendId: 'blend-1', name: 'Modern' },
])('keeps the source name separate from the numbered heading: $name', (source) => {
    const state = useRoastingStore.getState();
    state.prepareWorkspace('user-1');
    if (source.selectedBlendId) state.prepareBlend(source.selectedBlendId, source.name);
    else state.prepareBean(source.selectedBeanId, source.name);
    const host = document.createElement('div');
    const root = createRoot(host);
    act(() => root.render(createElement(RoastHeader, { ...props, ...source })));
    let sessionId = '';
    act(() => {
        sessionId = state.startCharge(undefined, 'user-1') ?? '';
        state.assignBatchNumbers(sessionId, 'user-1', 3, 10, 'profile');
    });
    expect(host.querySelector('span')?.textContent).toBe(`${source.name} #3`);
    expect(useRoastingStore.getState().prepared.beanName).toBe(source.name);
    expect(useRoastingStore.getState().activeSelection?.identity?.name).toBe(source.name);
    act(() => state.assignBatchNumbers(sessionId, 'user-1', 3, 10, 'profile'));
    expect(host.querySelector('span')?.textContent).toBe(`${source.name} #3`);
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

it('keeps bean selection available beside the editable title while roasting or ended', () => {
    const state = useRoastingStore.getState();
    state.prepareWorkspace('user-1');
    state.startCharge(undefined, 'user-1');
    const host = document.createElement('div');
    const root = createRoot(host);
    act(() => root.render(createElement(RoastHeader, props)));
    const beanSelect = host.querySelector('select');
    expect(beanSelect?.disabled).toBe(false);
    act(() => useRoastingStore.setState({ phase: 'ended' }));
    expect(beanSelect?.disabled).toBe(false);
    act(() => useRoastingStore.setState({ phase: 'standby' }));
    expect(beanSelect?.disabled).toBe(false);
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

describe('inline running title edits', () => {
    let host: HTMLDivElement;
    let root: Root;
    let sessionId: string;
    const titleButton = () => host.querySelector('button[title="activeRoast.header.batchTitle"]');
    const input = () => host.querySelector('input');
    const type = (value: string) => {
        act(() => {
            const element = input();
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(element, value);
            element?.dispatchEvent(new Event('input', { bubbles: true }));
        });
    };
    const press = (key: string, isComposing = false) =>
        act(() => input()?.dispatchEvent(new KeyboardEvent('keydown', { key, isComposing, bubbles: true })));

    beforeEach(() => {
        const state = useRoastingStore.getState();
        state.prepareWorkspace('user-1');
        state.prepareBean('bean-2', '마라닉');
        host = document.createElement('div');
        document.body.append(host);
        root = createRoot(host);
        act(() => root.render(createElement(RoastHeader, { ...props, selectedBeanId: 'bean-2' })));
        act(() => {
            sessionId = state.startCharge(undefined, 'user-1') ?? '';
            state.assignBatchNumbers(sessionId, 'user-1', 3, 10, 'profile');
        });
    });
    afterEach(() => act(() => root.unmount()));

    it.each(['Enter', 'blur'])('saves a clicked title on %s without renaming the bean', (commit) => {
        click(titleButton());
        expect(input()).toBe(document.activeElement);
        expect(input()?.value).toBe('마라닉 #3');
        expect(input()?.maxLength).toBe(120);
        type('  Morning roast  ');
        if (commit === 'Enter') press('Enter');
        else act(() => input()?.blur());
        expect(input()).toBeNull();
        expect(titleButton()?.textContent).toBe('Morning roast');
        expect(useRoastingStore.getState().prepared.beanName).toBe('마라닉');
        act(() => useRoastingStore.getState().assignBatchNumbers(sessionId, 'user-1', 4, 11, 'profile'));
        expect(titleButton()?.textContent).toBe('Morning roast');
    });

    it('cancels with Escape and allows the next edit to save', () => {
        click(titleButton());
        type('Discard me');
        press('Escape');
        expect(input()).toBeNull();
        expect(titleButton()?.textContent).toBe('마라닉 #3');
        click(titleButton());
        type('Keep me');
        press('Enter');
        expect(titleButton()?.textContent).toBe('Keep me');
    });

    it('restores the automatic title when cleared', () => {
        act(() => useRoastingStore.getState().setRunningBatchTitle(sessionId, 'Custom title'));
        click(titleButton());
        type('  ');
        press('Enter');
        expect(titleButton()?.textContent).toBe('마라닉 #3');
        expect(useRoastingStore.getState().activeSelection?.identity?.edited).toBe(false);
    });

    it('keeps a late number allocation when an untouched editor is closed', () => {
        click(titleButton());
        act(() => useRoastingStore.getState().assignBatchNumbers(sessionId, 'user-1', 4, 11, 'profile'));
        act(() => input()?.blur());
        expect(titleButton()?.textContent).toBe('마라닉 #4');
        expect(useRoastingStore.getState().activeSelection?.identity?.edited).not.toBe(true);
    });

    it('does not commit Enter while composing Korean text', () => {
        click(titleButton());
        type('아침 로스팅');
        press('Enter', true);
        expect(input()?.value).toBe('아침 로스팅');
        expect(useRoastingStore.getState().activeSelection?.identity?.title).toBe('마라닉 #3');
        press('Enter');
        expect(titleButton()?.textContent).toBe('아침 로스팅');
    });

    it('discards the draft when the next batch starts', () => {
        click(titleButton());
        type('Previous batch draft');
        act(() => {
            const state = useRoastingStore.getState();
            state.resetCurrentBatch();
            const nextId = state.startCharge(undefined, 'user-1') ?? '';
            state.assignBatchNumbers(nextId, 'user-1', 4, 11, 'profile');
        });
        expect(input()).toBeNull();
        expect(titleButton()?.textContent).toBe('마라닉 #4');
    });

    it('does not edit a batch belonging to a different workspace', () => {
        act(() => useRoastingStore.setState({ sessionOwnerId: 'other' }));
        expect(titleButton()).toBeNull();
        expect(input()).toBeNull();
        expect(host.querySelector('span')?.textContent).toBe('마라닉 #3');
    });
});
