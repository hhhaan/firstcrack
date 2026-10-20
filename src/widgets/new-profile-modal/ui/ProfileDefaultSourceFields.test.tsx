// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { ProfileDefaultSourceFields } from './ProfileDefaultSourceFields';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
it('adds a blend alongside a registered single and allows removing one without clearing the other', () => {
    const host = document.createElement('div');
    const root = createRoot(host);
    const setSources = vi.fn();
    const props = {
        beans: [{ id: 'b1', name: 'Single' }],
        blends: [{ id: 'x1', name: 'Modern' }],
        sources: [{ bean_id: 'b1', blend_id: null }],
        setSources,
    };
    act(() => root.render(createElement(ProfileDefaultSourceFields, props)));
    act(() => host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[1].click());
    expect(setSources).toHaveBeenCalledWith([
        { bean_id: 'b1', blend_id: null },
        { bean_id: null, blend_id: 'x1' },
    ]);
    act(() =>
        root.render(createElement(ProfileDefaultSourceFields, { ...props, sources: setSources.mock.calls[0][0] })),
    );
    act(() => host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[0].click());
    expect(setSources).toHaveBeenLastCalledWith([{ bean_id: null, blend_id: 'x1' }]);
    act(() => root.unmount());
});
