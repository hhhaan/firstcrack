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

test('temperature grid switches between default and a custom tick list without losing saved values', async ({
    authedPage: page,
}, testInfo) => {
    await page.getByTestId('app-sidebar').getByRole('button', { name: 'Settings', exact: true }).click();
    const settings = page.getByTestId('settings-page');
    const navigation = settings.getByRole('navigation', { name: 'Settings', exact: true });
    await navigation.getByRole('button', { name: 'Roasting', exact: true }).click();
    const grid = settings.getByRole('combobox', { name: 'Temperature grid', exact: true });
    const ticks = settings.locator('#roast-temp-ticks');
    await expect(grid).toHaveText('10°C (default)');
    await expect(ticks).toBeHidden();
    await expect(settings.locator('#roast-temp-grid-custom')).toHaveCount(0);
    await grid.click();
    await expect(page.getByRole('option')).toHaveCount(5);
    await page.getByRole('option', { name: '20°C', exact: true }).click();
    await expect(grid).toHaveText('20°C');
    await grid.click();
    await page.getByRole('option', { name: 'Custom', exact: true }).click();
    await expect(ticks).toBeHidden();
    const interval = settings.locator('#roast-temp-grid-custom');
    await interval.fill('20');
    await interval.blur();
    await expect(interval).toHaveValue('20');
    await expect(settings.getByRole('combobox', { name: 'Temperature label frequency', exact: true })).toBeEnabled();
    await interval.fill('30');
    await interval.blur();
    await expect(interval).toHaveValue('30');
    const labelFrequency = settings.getByRole('combobox', { name: 'Temperature label frequency', exact: true });
    await labelFrequency.click();
    await expect(page.getByRole('option')).toHaveCount(5);
    await page.getByRole('option', { name: '2-step interval', exact: true }).click();
    await expect(labelFrequency).toHaveText('2-step interval');
    await labelFrequency.click();
    await page.getByRole('option', { name: 'Custom', exact: true }).click();
    const labelInput = settings.locator('#roast-tempLabelEvery-custom');
    await labelInput.fill('3');
    await labelInput.blur();
    await expect(labelInput).toHaveValue('3');
    const timeSpacing = settings.getByRole('combobox', { name: 'Time tick interval', exact: true });
    await timeSpacing.click();
    await expect(page.getByRole('option')).toHaveCount(5);
    await page.getByRole('option', { name: '90 seconds', exact: true }).click();
    await expect(timeSpacing).toHaveText('90 seconds');
    await timeSpacing.click();
    await page.getByRole('option', { name: 'Custom', exact: true }).click();
    const timeInput = settings.locator('#roast-timeTickIntervalSec-custom');
    await timeInput.fill('45');
    await timeInput.blur();
    await expect(timeInput).toHaveValue('45');
    await timeSpacing.click();
    await page.getByRole('option', { name: '60 seconds (default)', exact: true }).click();
    await expect(timeInput).toBeHidden();
    await timeSpacing.click();
    await page.getByRole('option', { name: 'Custom', exact: true }).click();
    await expect(timeInput).toHaveValue('45');
    const inputMethod = settings.getByRole('tablist', { name: 'Input method', exact: true });
    await inputMethod.getByRole('tab', { name: 'Specific temperatures', exact: true }).click();
    await inputMethod.getByRole('tab', { name: 'Specific temperatures', exact: true }).press('ArrowLeft');
    await expect(interval).toBeVisible();
    await inputMethod.getByRole('tab', { name: 'Regular spacing', exact: true }).press('ArrowRight');
    await expect(interval).toBeHidden();
    await expect(labelInput).toBeHidden();
    await expect(ticks).toBeVisible();
    await ticks.fill('200, 150, 175, 150');
    await settings.getByRole('heading', { name: 'Axis ticks', exact: true }).click();
    await expect(ticks).toHaveValue('150, 175, 200');
    await expect(grid).toHaveText('Custom');
    await expect(settings.getByRole('combobox', { name: 'Temperature label frequency', exact: true })).toBeHidden();
    await settings.getByRole('radio', { name: '°F', exact: true }).check();
    await expect(ticks).toHaveValue('302, 347, 392');
    await grid.click();
    await page.getByRole('option', { name: '10°F (default)', exact: true }).click();
    await expect(ticks).toBeHidden();
    await grid.click();
    await page.getByRole('option', { name: 'Custom', exact: true }).click();
    await expect(ticks).toHaveValue('302, 347, 392');
    await navigation.getByRole('button', { name: 'General', exact: true }).click();
    await navigation.getByRole('button', { name: 'Roasting', exact: true }).click();
    await expect(grid).toHaveText('Custom');
    await expect(ticks).toHaveValue('302, 347, 392');
    await ticks.fill('100, bad');
    await settings.getByRole('heading', { name: 'Axis ticks', exact: true }).click();
    await expect(ticks).toHaveAttribute('aria-invalid', 'true');
    await expect(ticks).toHaveValue('100, bad');
    await ticks.fill('');
    await settings.getByRole('heading', { name: 'Axis ticks', exact: true }).click();
    await expect(ticks).toBeVisible();
    await expect(ticks).toHaveValue('');
    await expect(ticks).toHaveAttribute('aria-invalid', 'false');
    await expect(grid).toHaveText('Custom');
    await inputMethod.getByRole('tab', { name: 'Regular spacing', exact: true }).click();
    await expect(ticks).toBeHidden();
    await expect(interval).toHaveValue('30');
    await expect(labelInput).toHaveValue('3');
    await expect(timeInput).toHaveValue('45');
    await inputMethod.getByRole('tab', { name: 'Specific temperatures', exact: true }).click();
    await ticks.fill('302, 347, 392');
    await settings.getByRole('heading', { name: 'Axis ticks', exact: true }).click();
    await page.setViewportSize({ width: 960, height: 700 });
    await ticks.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath('axis-ticks-custom-list.png') });
});
