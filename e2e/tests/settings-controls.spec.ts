import { expect, test } from '../fixtures/app';

test('settings switches and series checkboxes preserve keyboard edits when reopened', async ({
    authedPage: page,
}, testInfo) => {
    const settings = page.getByTestId('settings-page');
    const navigation = settings.getByRole('navigation');
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await navigation.getByRole('button', { name: 'Roasting', exact: true }).click();
    await navigation.getByRole('button', { name: 'Alerts', exact: true }).click();

    const alarms = settings.getByRole('switch', { name: /^Enable alarms/ });
    const afterCharge = settings.getByRole('switch', { name: 'After charge', exact: true });
    const sound = settings.getByRole('switch', { name: /^Alarm sound/ });
    const initialSound = await sound.isChecked();
    await sound.focus();
    await sound.press('Space');
    await expect(sound).toBeChecked({ checked: !initialSound });
    const initialAlarms = await alarms.isChecked();
    const initialAfterCharge = await afterCharge.isChecked();
    await alarms.focus();
    await alarms.press('Space');
    await expect(alarms).toBeChecked({ checked: !initialAlarms });
    await afterCharge.focus();
    await afterCharge.press('Space');
    await expect(afterCharge).toBeChecked({ checked: !initialAfterCharge });
    await page.screenshot({ path: testInfo.outputPath('settings-alerts.png'), animations: 'disabled' });

    await navigation.getByRole('button', { name: 'Chart display', exact: true }).click();
    const et = settings.getByRole('checkbox', { name: /^Env Temp \(ET\)/ });
    const initialEt = await et.isChecked();
    await et.focus();
    await et.press('Space');
    await expect(et).toBeChecked({ checked: !initialEt });

    await settings.getByRole('button', { name: 'Close settings', exact: true }).click();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await navigation.getByRole('button', { name: 'Roasting', exact: true }).click();
    await navigation.getByRole('button', { name: 'Alerts', exact: true }).click();
    await expect(alarms).toBeChecked({ checked: !initialAlarms });
    await expect(afterCharge).toBeChecked({ checked: !initialAfterCharge });
    await expect(sound).toBeChecked({ checked: !initialSound });
    await navigation.getByRole('button', { name: 'Chart display', exact: true }).click();
    await expect(et).toBeChecked({ checked: !initialEt });
});
