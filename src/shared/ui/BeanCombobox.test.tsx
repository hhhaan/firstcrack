// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it } from 'vitest';
import { BeanCombobox } from './BeanCombobox';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const UUID = '11111111-1111-4111-8111-111111111111';

afterEach(() => {
    document.body.innerHTML = '';
});

it('lists a newly created lot while an older lot is the selected label', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => {
        root.render(
            createElement(BeanCombobox, {
                'data-testid': 'roast-summary-bean',
                items: [
                    { id: UUID, name: 'QA PR576 Lot' },
                    { id: 'old-id', name: 'QA Test Ethiopia' },
                ],
                selectedId: 'old-id',
                onSelect: () => {},
            }),
        );
    });
    const input = host.querySelector('input') as HTMLInputElement;
    expect(input.value).toBe('QA Test Ethiopia');
    act(() => {
        input.focus();
        input.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
    });
    const option = [...host.querySelectorAll('[role="option"]')].find((el) => el.textContent === 'QA PR576 Lot');
    expect(option).toBeTruthy();
    expect(option?.getAttribute('data-bean-id')).toBe(UUID);
    act(() => root.unmount());
});
