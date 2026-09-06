// @vitest-environment jsdom
import { MasterDetail, MasterDetailLayout } from '@shared/ui/MasterDetailLayout';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement | undefined;
let root: Root | undefined;

function render(ui: ReactElement) {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
        root?.render(ui);
    });
    return host;
}

afterEach(() => {
    act(() => {
        root?.unmount();
    });
    host?.remove();
    root = undefined;
    host = undefined;
});

describe('MasterDetail', () => {
    it('renders master and detail slots', () => {
        const el = render(
            <MasterDetail.Root>
                <MasterDetail.Master>list</MasterDetail.Master>
                <MasterDetail.Detail>detail</MasterDetail.Detail>
            </MasterDetail.Root>,
        );
        expect(el.textContent).toContain('list');
        expect(el.textContent).toContain('detail');
    });

    it('Layout placeholder appears when detail is missing', () => {
        const el = render(<MasterDetailLayout left="list" placeholder="pick one" />);
        expect(el.textContent).toContain('list');
        expect(el.textContent).toContain('pick one');
    });
});
