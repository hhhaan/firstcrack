// @vitest-environment jsdom
import { act, createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AddBlendModal } from './AddBlendModal';

const blendMutations = vi.hoisted(() => ({
    create: vi.fn(),
    update: vi.fn(),
}));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, options?: { message?: string }) => (options?.message ? `${key} ${options.message}` : key),
    }),
}));

vi.mock('@entities/bean', () => ({
    useBeans: () => ({ data: [{ id: 'bean-1', name: 'Yirg' }] }),
}));

vi.mock('@entities/organization', () => ({
    useActiveWorkspace: () => ({ workspaceOwnerId: 'user-1' }),
}));

vi.mock('@entities/blend', () => ({
    useCreateBlend: () => {
        const [isPending, setPending] = useState(false);
        return {
            isPending,
            mutateAsync: async (vars: unknown) => {
                setPending(true);
                try {
                    return await blendMutations.create(vars);
                } finally {
                    setPending(false);
                }
            },
        };
    },
    useUpdateBlend: () => {
        const [isPending, setPending] = useState(false);
        return {
            isPending,
            mutateAsync: async (vars: unknown) => {
                setPending(true);
                try {
                    return await blendMutations.update(vars);
                } finally {
                    setPending(false);
                }
            },
        };
    },
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mounts: Array<{ unmount: () => void }> = [];

const deferred = () => {
    let resolve: (value: unknown) => void = () => {};
    let reject: (error: unknown) => void = () => {};
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
};

const mount = (onClose: () => void) => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => root.render(createElement(AddBlendModal, { open: true, onClose, editing: null })));
    const instance = {
        unmount: () => {
            act(() => root.unmount());
            host.remove();
        },
    };
    mounts.push(instance);
    return instance;
};

afterEach(() => {
    for (const instance of mounts.splice(0)) instance.unmount();
});

beforeEach(() => {
    blendMutations.create.mockReset();
    blendMutations.update.mockReset();
});

const setNativeValue = (el: HTMLInputElement | HTMLSelectElement, value: string) => {
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set;
    setter?.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
};

const addButton = () =>
    [...document.querySelectorAll('button')].find((button) => button.textContent === 'beans.blend.modal.add') as
        | HTMLButtonElement
        | undefined;

const fillValid = async () => {
    const name = document.querySelector('input[placeholder="beans.blend.modal.namePlaceholder"]') as HTMLInputElement;
    const select = document.querySelector('select') as HTMLSelectElement;
    await act(async () => {
        setNativeValue(name, 'House');
        setNativeValue(select, 'bean-1');
    });
};

describe('AddBlendModal submit lock', () => {
    it('creates one blend when Add is submitted twice before the response', async () => {
        const first = deferred();
        blendMutations.create.mockImplementationOnce(() => first.promise);
        const onClose = vi.fn();
        mount(onClose);
        await fillValid();

        const button = addButton();
        expect(button?.disabled).toBe(false);
        await act(async () => {
            button?.click();
            button?.click();
        });

        expect(blendMutations.create).toHaveBeenCalledTimes(1);
        expect(blendMutations.create).toHaveBeenCalledWith({
            blend: { name: 'House', description: undefined, user_id: 'user-1' },
            components: [{ bean_id: 'bean-1', ratio_pct: 100 }],
        });
        expect(addButton()?.disabled).toBe(true);
        expect(onClose).not.toHaveBeenCalled();

        await act(async () => {
            first.resolve({ id: 'blend-1' });
        });
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('keeps the modal open on failure and creates one blend on retry', async () => {
        const first = deferred();
        const second = deferred();
        blendMutations.create.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);
        const onClose = vi.fn();
        mount(onClose);
        await fillValid();

        await act(async () => {
            addButton()?.click();
        });
        await act(async () => {
            first.reject(new Error('server down'));
        });

        expect(onClose).not.toHaveBeenCalled();
        expect(document.querySelector('[role="alert"]')?.textContent).toContain('server down');
        expect(document.getElementById('add-blend-modal-title')).toBeTruthy();
        expect(addButton()?.disabled).toBe(false);

        await act(async () => {
            addButton()?.click();
        });
        expect(blendMutations.create).toHaveBeenCalledTimes(2);
        await act(async () => {
            second.resolve({ id: 'blend-1' });
        });
        expect(onClose).toHaveBeenCalledTimes(1);
    });
});
