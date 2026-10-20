import { expect, goNav, test } from '../fixtures/app';

for (const height of [720, 360]) {
    test(`bean menu stays within a ${height}px viewport and starts at the top without a selection`, async ({
        authedPage: page,
        db,
    }) => {
        await page.setViewportSize({ width: 1280, height });
        for (let index = 0; index < 40; index++) {
            const name = `Menu lot ${String(index).padStart(2, '0')}`;
            db.createBean({ name, origin: name });
        }
        await page.reload();
        await goNav(page, 'roast');
        const trigger = page.getByRole('combobox', { name: 'Green Bean', exact: true });
        const menu = page.getByRole('listbox');
        const none = page.getByRole('option', { name: 'No Bean Selected', exact: true });
        await trigger.click();
        await expect(menu.getByRole('option')).toHaveCount(41);
        await expect(none).toBeInViewport({ ratio: 1 });
        const bounds = await menu.boundingBox();
        if (!bounds) throw new Error('Bean menu has no visible bounds');
        expect(bounds.y).toBeGreaterThanOrEqual(0);
        expect(bounds.y + bounds.height).toBeLessThanOrEqual(height);
        expect(bounds.height).toBeLessThanOrEqual(224);

        // Navigate to the bottom, then clear the selection and reopen.
        await page.keyboard.press('End');
        await expect(menu.getByRole('option').last()).toBeFocused();
        await page.keyboard.press('Enter');
        await expect(trigger).toContainText('Menu lot');
        await trigger.click();
        await page.keyboard.press('Home');
        await expect(none).toBeFocused();
        await page.keyboard.press('Enter');
        await expect(trigger).toContainText('No Bean Selected');
        await trigger.click();
        await expect(none).toBeInViewport({ ratio: 1 });
        await expect(menu.locator('[data-radix-select-viewport]')).toHaveJSProperty('scrollTop', 0);
        await page.keyboard.press('Escape');
        await expect(trigger).toBeFocused();
    });
}
