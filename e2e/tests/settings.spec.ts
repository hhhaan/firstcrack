import { expect, goNav, test } from '../fixtures/app';

test('settings is a responsive page and preserves existing preferences and entry points', async ({
    authedPage: page,
}, testInfo) => {
    await goNav(page, 'beans');
    const appRail = page.getByTestId('app-sidebar');
    await appRail.getByRole('button', { name: 'Settings', exact: true }).click();
    const settings = page.getByTestId('settings-page');
    const navigation = settings.getByRole('navigation', { name: 'Settings', exact: true });
    await expect(settings).toBeVisible();
    await expect(appRail).toBeHidden();
    await expect(settings.getByRole('main').getByRole('heading', { name: 'General', exact: true })).toBeFocused();
    await expect(page.locator('[role="dialog"][aria-labelledby="settings-modal-title"]')).toHaveCount(0);
    for (const group of ['Workspace', 'Account', 'Application']) {
        await expect(navigation.getByRole('heading', { name: group, exact: true })).toBeVisible();
    }

    const search = settings.getByRole('searchbox', { name: 'Search settings', exact: true });
    await search.fill('  STOCK  horizon  ');
    await expect(navigation.getByRole('button')).toHaveCount(1);
    await expect(navigation.getByRole('button', { name: 'General', exact: true })).toBeVisible();
    await expect(navigation.getByRole('heading', { name: 'Account', exact: true })).toHaveCount(0);
    await search.fill('ror');
    await expect(settings.getByRole('main').getByRole('heading', { name: 'Roasting', exact: true })).toBeVisible();
    await expect(search).toBeFocused();
    await expect(settings.getByRole('main').getByRole('heading', { name: 'RoR Span', exact: true })).toBeVisible();
    await expect(
        settings.getByRole('main').getByRole('heading', { name: 'Temperature Unit', exact: true }),
    ).toBeHidden();
    await page.screenshot({ path: testInfo.outputPath('settings-search.png') });
    await expect(search).toHaveValue('ror');
    await search.fill('no-such-setting');
    await expect(navigation.getByRole('button')).toHaveCount(0);
    await expect(navigation.getByRole('status')).toHaveText('No settings found.');
    await expect(settings.getByRole('main').getByRole('status')).toHaveText('No settings found.');
    await search.fill('   ');
    await expect(navigation.getByRole('button')).toHaveCount(7);
    await search.fill('');
    await navigation.getByRole('button', { name: 'General', exact: true }).click();

    const language = settings.getByLabel('App language', { exact: true });
    await expect(language.locator('option')).toHaveCount(4);
    await language.selectOption('ko');
    await expect(settings.getByLabel('앱 언어', { exact: true })).toHaveValue('ko');
    await settings.getByRole('searchbox', { name: '설정 검색', exact: true }).fill('재고');
    await expect(settings.getByRole('navigation').getByRole('button', { name: '일반', exact: true })).toBeVisible();
    await settings.getByRole('searchbox', { name: '설정 검색', exact: true }).fill('');
    await settings.getByLabel('앱 언어', { exact: true }).selectOption('en');
    await settings.getByLabel('Stock alert horizon', { exact: true }).fill('42');

    for (const tab of ['Roasting', 'Team', 'Profile', 'Billing', 'Software', 'Support', 'General']) {
        await navigation.getByRole('button', { name: tab, exact: true }).click();
        await expect(
            settings.getByRole('main').getByRole('heading', { name: tab, exact: true, level: 1 }),
        ).toBeVisible();
        await expect(navigation.getByRole('button', { name: tab, exact: true })).toHaveAttribute(
            'aria-current',
            'page',
        );
    }
    await expect(settings.getByLabel('Stock alert horizon', { exact: true })).toHaveValue('42');
    await page.screenshot({ path: testInfo.outputPath('settings-desktop.png') });
    await navigation.getByRole('button', { name: 'Profile', exact: true }).click();
    await page.screenshot({ path: testInfo.outputPath('settings-profile-desktop.png') });

    await navigation.getByRole('button', { name: 'Roasting', exact: true }).click();
    await settings.getByRole('radio', { name: '°F', exact: true }).check();
    await expect(settings.getByRole('radio', { name: '°C', exact: true })).not.toBeChecked();
    await settings.getByRole('radio', { name: '°C', exact: true }).check();
    const visibilityToggle = settings
        .locator('[data-settings-section]')
        .filter({ has: page.getByRole('heading', { name: 'Data Visibility', exact: true }) })
        .getByRole('checkbox')
        .first();
    const wasChecked = await visibilityToggle.isChecked();
    await visibilityToggle.focus();
    await page.keyboard.press('Space');
    await expect(visibilityToggle).toBeChecked({ checked: !wasChecked });
    await page.keyboard.press('Space');
    await expect(visibilityToggle).toBeChecked({ checked: wasChecked });
    await page.screenshot({ path: testInfo.outputPath('settings-roasting.png') });
    await navigation.getByRole('button', { name: 'General', exact: true }).click();

    await page.setViewportSize({ width: 600, height: 700 });
    await page.screenshot({ path: testInfo.outputPath('settings-narrow.png') });
    await navigation.getByRole('button', { name: 'Profile', exact: true }).click();
    await page.screenshot({ path: testInfo.outputPath('settings-profile-narrow.png') });
    for (const tab of ['General', 'Roasting', 'Profile', 'Team', 'Billing', 'Software', 'Support']) {
        await navigation.getByRole('button', { name: tab, exact: true }).click();
        const main = settings.getByRole('main');
        await expect
            .poll(() => main.evaluate((element) => element.scrollWidth - element.clientWidth))
            .toBeLessThanOrEqual(1);
    }
    await settings.getByRole('button', { name: 'Close settings', exact: true }).click();
    await expect(settings).toBeHidden();
    await expect(page.getByTestId('beans-add-lot')).toBeVisible();
    await expect(appRail).toHaveCSS('width', '170px');

    await page.setViewportSize({ width: 1280, height: 800 });
    await goNav(page, 'roast');
    await page.getByRole('button', { name: 'Open roast settings', exact: true }).click();
    await expect(settings.getByRole('main').getByRole('heading', { name: 'Roasting', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(settings).toBeVisible();
    await settings.getByRole('button', { name: 'Close settings', exact: true }).click();
    await expect(settings).toBeHidden();
});
