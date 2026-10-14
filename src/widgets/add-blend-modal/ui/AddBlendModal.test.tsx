// @vitest-environment jsdom
import { BLEND_DUPLICATE_BEAN_MESSAGE, BLEND_RATIO_SUM_MESSAGE } from '@entities/blend/lib';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AddBlendModal } from './AddBlendModal';

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, opts?: { total?: number }) => (opts && 'total' in opts ? `${key}:${opts.total}` : key),
    }),
}));

vi.mock('@entities/bean', () => ({
    useBeans: () => ({
        data: [
            { id: 'bean-a', name: 'Ethiopia' },
            { id: 'bean-b', name: 'Brazil' },
        ],
    }),
}));

vi.mock('@entities/organization', () => ({
    useActiveWorkspace: () => ({ workspaceOwnerId: 'user-1' }),
}));

vi.mock('@entities/blend', () => ({
    blendWriteErrorMessage: () => null,
    useCreateBlend: () => ({ mutateAsync: vi.fn() }),
    useUpdateBlend: () => ({ mutateAsync: vi.fn() }),
}));

const setRatio = async (user: ReturnType<typeof userEvent.setup>, input: HTMLElement, digits: string) => {
    await user.clear(input);
    await user.type(input, digits);
};

const expectNoArrayErrors = async () => {
    await waitFor(() => {
        expect(screen.queryByText(BLEND_RATIO_SUM_MESSAGE)).toBeNull();
        expect(screen.queryByText(BLEND_DUPLICATE_BEAN_MESSAGE)).toBeNull();
    });
};

describe('AddBlendModal array errors', () => {
    it('updates duplicate and ratio-sum messages when beans or ratios change', async () => {
        const user = userEvent.setup();
        render(<AddBlendModal open onClose={() => {}} />);

        const ratioInputs = () => screen.getAllByRole('spinbutton');
        await setRatio(user, ratioInputs()[0], '60');
        await user.click(screen.getByRole('button', { name: 'beans.blend.modal.addComponent' }));

        expect(ratioInputs()).toHaveLength(2);
        expect(await screen.findByText(BLEND_RATIO_SUM_MESSAGE)).toBeTruthy();

        const selects = screen.getAllByRole('combobox');
        await user.selectOptions(selects[0], 'bean-a');
        await user.selectOptions(selects[1], 'bean-a');
        await setRatio(user, ratioInputs()[0], '50');
        await setRatio(user, ratioInputs()[1], '50');

        expect(await screen.findByText(BLEND_DUPLICATE_BEAN_MESSAGE)).toBeTruthy();
        expect(screen.queryByText(BLEND_RATIO_SUM_MESSAGE)).toBeNull();

        await user.selectOptions(selects[1], 'bean-b');
        await setRatio(user, ratioInputs()[0], '60');
        await setRatio(user, ratioInputs()[1], '40');
        await expectNoArrayErrors();

        await setRatio(user, ratioInputs()[1], '30');
        expect(await screen.findByText(BLEND_RATIO_SUM_MESSAGE)).toBeTruthy();
        expect(screen.queryByText(BLEND_DUPLICATE_BEAN_MESSAGE)).toBeNull();

        await setRatio(user, ratioInputs()[1], '40');
        await expectNoArrayErrors();

        const submit = screen.getByRole('button', { name: 'beans.blend.modal.add' });
        expect((submit as HTMLButtonElement).disabled).toBe(true);
        await user.type(screen.getAllByRole('textbox')[0], 'House');
        await waitFor(() => {
            expect((submit as HTMLButtonElement).disabled).toBe(false);
        });
    });
});
