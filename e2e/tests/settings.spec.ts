import { devices } from '@playwright/test';
import { expect, goNav, test } from '../fixtures/app';

// Match the host platform so the shortcut matcher and native modifier labels agree.
test.use({
    userAgent:
        process.platform === 'darwin'
            ? devices['Desktop Chrome'].userAgent.replace(
                  'Windows NT 10.0; Win64; x64',
                  'Macintosh; Intel Mac OS X 10_15_7',
              )
            : devices['Desktop Chrome'].userAgent,
});

test('shortcut toggles preserve edited keys across reloads and restore defaults', async ({
    authedPage: page,
}, testInfo) => {
    const modifier = await page.evaluate(() => (/mac/i.test(navigator.userAgent) ? 'Meta' : 'Control'));
    const modal = page.getByTestId('keyboard-shortcuts-modal');
    const settings = page.getByTestId('settings-page');
    await page.keyboard.press(`${modifier}+/`);
    await expect(modal.getByRole('switch')).toHaveCount(16);
    const toggle = modal.getByRole('switch', { name: 'Open settings', exact: true });
    const binding = modal.getByRole('button', { name: 'Change shortcut: Open settings', exact: true });
    await binding.click();
    await page.keyboard.press(`${modifier}+Shift+p`);
    const editedKeys = await binding.innerText();
    await toggle.uncheck();
    await page.keyboard.press('Escape');
    await page.keyboard.press(`${modifier}+Shift+p`);
    await expect(settings).toBeHidden();

    await page.reload();
    await expect(page.getByTestId('app-sidebar')).toBeVisible();
    await page.keyboard.press(`${modifier}+/`);
    await expect(toggle).not.toBeChecked();
    await expect(binding).toHaveText(editedKeys);
    await page.screenshot({ path: testInfo.outputPath('keyboard-shortcuts-toggles.png'), animations: 'disabled' });
    await toggle.check();
    await page.keyboard.press('Escape');
    await page.keyboard.press(`${modifier}+Shift+p`);
    await expect(settings).toBeVisible();
    await settings.getByRole('button', { name: 'Close settings', exact: true }).click();

    await page.keyboard.press(`${modifier}+/`);
    await toggle.uncheck();
    await modal.getByRole('button', { name: 'Restore all defaults', exact: true }).click();
    await expect(toggle).toBeChecked();
    await expect(binding).not.toHaveText(editedKeys);
    await expect(modal.getByRole('button', { name: 'Restore all defaults', exact: true })).toBeDisabled();
    await page.setViewportSize({ width: 600, height: 700 });
    await expect
        .poll(() => modal.evaluate((element) => element.scrollWidth - element.clientWidth))
        .toBeLessThanOrEqual(1);
    await page.screenshot({
        path: testInfo.outputPath('keyboard-shortcuts-toggles-narrow.png'),
        animations: 'disabled',
    });
});

test('settings shortcut, Feedback, and shortcut editing work through the app shell', async ({
    authedPage: page,
}, testInfo) => {
    const modifier = await page.evaluate(() => (/mac/i.test(navigator.userAgent) ? 'Meta' : 'Control'));
    const sidebar = page.getByTestId('app-sidebar');
    const settings = page.getByTestId('settings-page');
    await expect(sidebar.getByRole('button', { name: 'More', exact: true })).toHaveCount(0);
    await sidebar.getByRole('button', { name: 'Settings', exact: true }).click();
    await settings
        .getByRole('navigation', { name: 'Settings', exact: true })
        .getByRole('button', { name: 'Feedback', exact: true })
        .click();
    await expect(settings.getByRole('heading', { name: 'Send feedback', exact: true })).toBeVisible();
    await expect(settings.getByRole('button', { name: 'Send feedback', exact: true })).toBeVisible();
    await expect(settings.getByText('support@firstcrackiscoming.com', { exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('settings-feedback.png'), animations: 'disabled' });
    await settings.getByRole('button', { name: 'Close settings', exact: true }).click();

    await page.keyboard.press(`${modifier}+,`);
    await expect(settings).toBeVisible();
    const settingsSearch = settings.getByRole('searchbox', { name: 'Search settings', exact: true });
    await settingsSearch.fill('keyboard shortcuts');
    await expect(settings.getByRole('button', { name: 'Edit shortcuts', exact: true })).toBeVisible();
    await settingsSearch.fill('');
    await settings.getByRole('button', { name: 'Edit shortcuts', exact: true }).click();
    const modal = page.getByTestId('keyboard-shortcuts-modal');
    const search = modal.getByRole('searchbox', { name: 'Search shortcuts', exact: true });
    await expect(search).toBeFocused();
    await search.fill('Open settings');
    const changeSettings = modal.getByRole('button', { name: 'Change shortcut: Open settings', exact: true });
    await expect(modal.locator('[data-shortcut]')).toHaveCount(1);
    await changeSettings.click();
    await page.keyboard.press(`${modifier}+/`);
    await expect(modal.getByRole('alert')).toHaveText('This shortcut is already assigned to another action.');
    await page.keyboard.press('Escape');
    await expect(modal).toBeVisible();
    await expect(modal.getByRole('alert')).toHaveCount(0);
    await changeSettings.click();
    await page.keyboard.press(`${modifier}+Shift+p`);
    await expect(changeSettings).toHaveAttribute('aria-pressed', 'false');
    await search.fill('no-such-shortcut');
    await expect(modal.getByText('No matching shortcuts', { exact: true })).toBeVisible();
    await search.fill('');
    await expect(modal.getByRole('button', { name: 'Restore all defaults', exact: true })).toBeEnabled();
    await page.screenshot({ path: testInfo.outputPath('keyboard-shortcuts-edited.png'), animations: 'disabled' });
    await page.keyboard.press('Escape');
    await expect(modal).toBeHidden();
    await expect(settings).toBeVisible();
    await settingsSearch.focus();
    await page.keyboard.press('Escape');
    await expect(settings).toBeHidden();
    await page.keyboard.press(`${modifier}+,`);
    await expect(settings).toBeHidden();
    await page.keyboard.press(`${modifier}+Shift+p`);
    await expect(settings).toBeVisible();

    await page.reload();
    await expect(sidebar).toBeVisible();
    await page.keyboard.press(`${modifier}+,`);
    await expect(settings).toBeHidden();
    await page.keyboard.press(`${modifier}+Shift+p`);
    await expect(settings).toBeVisible();

    await page.keyboard.press(`${modifier}+/`);
    await modal.getByRole('button', { name: 'Restore all defaults', exact: true }).click();
    await expect(modal.getByRole('button', { name: 'Restore all defaults', exact: true })).toBeDisabled();
    await page.setViewportSize({ width: 600, height: 700 });
    await expect
        .poll(() => modal.evaluate((element) => element.scrollWidth - element.clientWidth))
        .toBeLessThanOrEqual(1);
    await page.screenshot({ path: testInfo.outputPath('keyboard-shortcuts-narrow.png'), animations: 'disabled' });
    await page.keyboard.press('Escape');
    await settings.getByRole('button', { name: 'Close settings', exact: true }).click();
    await page.keyboard.press(`${modifier}+,`);
    await expect(settings).toBeVisible();
});

test('BT smoothing supports custom strength, keyboard input, reopening and reset', async ({
    authedPage: page,
}, testInfo) => {
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const settings = page.getByTestId('settings-page');
    await settings.getByRole('navigation').getByRole('button', { name: 'Roasting', exact: true }).click();
    const slider = settings.getByRole('slider', { name: 'BT smoothing strength', exact: true });
    const value = settings.getByRole('spinbutton', { name: 'BT smoothing strength value', exact: true });
    await expect(value).toHaveValue('0');
    await value.fill('75');
    await value.press('Enter');
    await expect(slider).toHaveValue('75');
    await slider.focus();
    await slider.press('End');
    await expect(value).toHaveValue('100');
    await value.fill('80');
    await value.blur();
    await expect(slider).toHaveValue('80');
    await settings
        .locator('[data-settings-section]')
        .filter({
            has: page.getByRole('slider', { name: 'BT smoothing strength', exact: true }),
        })
        .screenshot({ path: testInfo.outputPath('bt-smoothing-custom.png') });
    await settings.getByRole('button', { name: 'Close settings', exact: true }).click();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await settings.getByRole('navigation').getByRole('button', { name: 'Roasting', exact: true }).click();
    await expect(value).toHaveValue('80');
    const btSection = settings.locator('[data-settings-section]').filter({
        has: page.getByRole('slider', { name: 'BT smoothing strength', exact: true }),
    });
    await btSection.getByRole('button', { name: 'Restore default (0)', exact: true }).click();
    await expect(value).toHaveValue('0');
    await expect(slider).toHaveValue('0');
    const etValue = settings.getByRole('spinbutton', { name: 'ET smoothing strength value', exact: true });
    await expect(etValue).toHaveValue('0');
    await etValue.fill('25');
    await etValue.press('Enter');
    await expect(settings.getByRole('slider', { name: 'ET smoothing strength', exact: true })).toHaveValue('25');
    await expect(value).toHaveValue('0');
    await value.fill('');
    await value.blur();
    await expect(value).toHaveValue('0');
});

test('settings is a responsive page and preserves existing preferences and entry points', async ({
    authedPage: page,
}, testInfo) => {
    await goNav(page, 'beans');
    const appRail = page.getByTestId('app-sidebar');
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
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
    await expect(navigation.getByRole('button')).toHaveCount(14);
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

    for (const tab of ['Roasting', 'Team', 'Profile', 'Billing', 'Software', 'Feedback', 'General']) {
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
    await page.screenshot({ path: testInfo.outputPath('settings-roasting-top.png') });
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
    for (const tab of ['General', 'Roasting', 'Profile', 'Team', 'Billing', 'Software', 'Feedback']) {
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
    await expect(settings).toBeHidden();
    await expect(page.getByRole('button', { name: 'Open roast settings', exact: true })).toBeVisible();
});

test('roasting submenus filter sections while search and saved preferences span every group', async ({
    authedPage: page,
}, testInfo) => {
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const settings = page.getByTestId('settings-page');
    const navigation = settings.getByRole('navigation');
    const main = settings.getByRole('main');
    const roast = navigation.getByRole('button', { name: 'Roasting', exact: true });
    await roast.click();
    await expect(roast).toHaveAttribute('aria-expanded', 'true');
    const submenus = navigation.getByRole('list', { name: 'Roasting', exact: true });
    await expect(submenus.getByRole('button')).toHaveCount(7);
    await submenus.getByRole('button', { name: 'Axes & controls', exact: true }).click();
    await expect(main.getByRole('heading', { name: 'Axes & controls', exact: true })).toBeFocused();
    await expect(main.getByRole('heading', { name: 'Axis ticks', exact: true })).toBeVisible();
    await expect(main.getByRole('heading', { name: 'Live Alarms', exact: true })).toBeHidden();
    await expect(navigation.locator('[aria-current="page"]')).toHaveCount(1);

    const sensors = submenus.getByRole('button', { name: 'Sensors & RoR', exact: true });
    await sensors.focus();
    await sensors.press('Enter');
    const strength = main.getByRole('spinbutton', { name: 'BT smoothing strength value', exact: true });
    await strength.fill('65');
    await strength.press('Enter');
    await submenus.getByRole('button', { name: 'Alerts', exact: true }).click();
    await expect(main.getByRole('heading', { name: 'Live Alarms', exact: true })).toBeVisible();
    await expect(strength).toBeHidden();
    await sensors.click();
    await expect(strength).toHaveValue('65');

    const search = settings.getByRole('searchbox', { name: 'Search settings', exact: true });
    await search.fill('temperature unit');
    await expect(main.getByRole('heading', { name: 'Temperature Unit', exact: true })).toBeVisible();
    await expect(search).toBeFocused();
    await search.fill('Automatic detection');
    await expect(main.getByRole('heading', { name: 'Auto Charge Detection', exact: true })).toBeVisible();
    await expect(main.getByRole('heading', { name: 'Temperature Unit', exact: true })).toBeHidden();
    await search.fill('');
    await expect(main.getByRole('heading', { name: 'Temperature Unit', exact: true })).toBeVisible();
    await expect(roast).toHaveAttribute('aria-current', 'page');

    await page.setViewportSize({ width: 600, height: 700 });
    for (const submenu of await submenus.getByRole('button').all()) {
        await submenu.click();
        await expect(main.getByRole('heading', { level: 2 }).first()).toBeVisible();
        await expect
            .poll(() => main.evaluate((element) => element.scrollWidth - element.clientWidth))
            .toBeLessThanOrEqual(1);
    }
    await page.screenshot({
        path: testInfo.outputPath('settings-roasting-submenu-narrow.png'),
        animations: 'disabled',
    });
    await roast.click();
    await expect(main.getByRole('heading', { name: 'Temperature Unit', exact: true })).toBeVisible();
    await roast.click();
    await expect(roast).toHaveAttribute('aria-expanded', 'false');
    await expect(submenus).toHaveCount(0);
    await roast.click();
    await expect(roast).toHaveAttribute('aria-expanded', 'true');
    await expect(submenus.getByRole('button')).toHaveCount(7);
    await navigation.getByRole('button', { name: 'General', exact: true }).click();
    await expect(submenus).toHaveCount(0);
    await settings.getByLabel('App language', { exact: true }).selectOption('ko');
    await navigation.getByRole('button', { name: '로스팅', exact: true }).click();
    await navigation.getByRole('button', { name: '알람', exact: true }).click();
    await expect(main.getByRole('heading', { name: '알람', exact: true, level: 1 })).toBeFocused();
    await expect(main.getByRole('heading', { name: '실시간 알람', exact: true })).toBeVisible();
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.screenshot({ path: testInfo.outputPath('settings-roasting-submenu-ko.png'), animations: 'disabled' });
});

test('temperature grid switches between default and a custom tick list without losing saved values', async ({
    authedPage: page,
}, testInfo) => {
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
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
