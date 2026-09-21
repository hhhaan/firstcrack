// @vitest-environment jsdom
import { zodResolver } from '@hookform/resolvers/zod';
import { act, createElement, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { FormProvider, useForm } from 'react-hook-form';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildBeanFormSchema, EMPTY_BEAN_FORM } from '../lib/schema';
import { BeanFormFields } from './BeanFormFields';

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key }),
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const LOT_NAME_REQUIRED = 'addBeanModal.form.lotNameRequired';
const t = (key: string) => key;

const Harness = () => {
    const schema = useMemo(() => buildBeanFormSchema(t), []);
    const form = useForm({
        resolver: zodResolver(schema),
        defaultValues: EMPTY_BEAN_FORM,
    });
    const [nameIsAuto, setNameIsAuto] = useState(true);
    const {
        register,
        handleSubmit,
        setValue,
        getValues,
        formState: { errors },
    } = form;

    return (
        <FormProvider {...form}>
            <BeanFormFields
                register={register}
                setValue={setValue}
                getValues={getValues}
                errors={errors}
                nameIsAuto={nameIsAuto}
                setNameIsAuto={setNameIsAuto}
                onSubmit={() => {}}
                handleSubmit={handleSubmit}
            />
        </FormProvider>
    );
};

const mounts: Array<{ host: HTMLElement; unmount: () => void }> = [];

const mount = () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => root.render(createElement(Harness)));
    const instance = {
        host,
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

const submitEmpty = async (host: HTMLElement) => {
    const form = host.querySelector('[data-testid="bean-form"]') as HTMLFormElement;
    await act(async () => {
        form.requestSubmit();
    });
};

const clickChip = async (host: HTMLElement, label: string) => {
    const chip = [...host.querySelectorAll('button')].find((button) => button.textContent === label);
    expect(chip).toBeTruthy();
    await act(async () => {
        chip?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
};

const typeName = async (host: HTMLElement, value: string) => {
    const input = host.querySelector('[data-testid="bean-form-name"]') as HTMLInputElement;
    await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
        setter?.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
    });
};

describe('BeanFormFields lot-name validation', () => {
    it('clears the required error when an origin chip fills the name', async () => {
        const { host } = mount();

        await submitEmpty(host);
        expect(host.textContent).toContain(LOT_NAME_REQUIRED);

        await clickChip(host, 'Ethiopia');
        const name = host.querySelector('[data-testid="bean-form-name"]') as HTMLInputElement;
        expect(name.value).toBe('Ethiopia');
        expect(host.textContent).not.toContain(LOT_NAME_REQUIRED);

        await clickChip(host, 'Ethiopia');
        expect(name.value).toBe('');
        expect(host.textContent).not.toContain(LOT_NAME_REQUIRED);
        await submitEmpty(host);
        expect(host.textContent).toContain(LOT_NAME_REQUIRED);
    });

    it('clears the required error when a name is typed, then re-shows it on empty submit', async () => {
        const { host } = mount();

        await submitEmpty(host);
        expect(host.textContent).toContain(LOT_NAME_REQUIRED);

        await typeName(host, 'Yirgacheffe');
        expect(host.textContent).not.toContain(LOT_NAME_REQUIRED);

        await typeName(host, '');
        await submitEmpty(host);
        expect(host.textContent).toContain(LOT_NAME_REQUIRED);
    });
});
