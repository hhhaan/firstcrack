import { expect, goNav, test } from '../fixtures/app';
import { E2E_USER } from '../fixtures/constants';

test('a past roast can be shown behind the live chart and cleared back to the profile', async ({
    authedPage: page,
    db,
}) => {
    const path = `profiles/${E2E_USER.id}/reference.tsv`;
    db.tsvFiles.set(
        path,
        'time\tbt\tet\tror\theater\tfan\tdrum\n0\t190\t210\t0\t70\t40\t50\n60\t140\t160\t5\t70\t40\t50\n600\t210\t230\t8\t30\t40\t50\n',
    );
    db.seedCompletedSession({
        tsv_path: path,
        beans: { name: 'Reference roast', origin: null, region: null, variety: null, process: null, farm: null },
    });
    await goNav(page, 'roast');
    const target = page.getByRole('combobox', { name: 'Target:' });
    await target.selectOption({ label: 'Choose a background roast' });
    const picker = page.getByTestId('history-reference-picker');
    await picker.getByRole('textbox').fill('Reference roast');
    await picker.getByRole('button', { name: /Reference roast/ }).click();
    await expect(picker.getByRole('button', { name: 'Show as background' })).toBeEnabled();
    await picker.getByRole('button', { name: 'Show as background' }).click();
    await expect(picker).toBeHidden();
    await expect(target.locator('option:checked')).toContainText('Reference roast');
    await target.selectOption({ label: 'Use profile background' });
    await expect(target.locator('option', { hasText: 'Reference roast' })).toHaveCount(0);
});
