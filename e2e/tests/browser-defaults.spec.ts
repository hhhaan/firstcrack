import { expect, goNav, test } from '../fixtures/app';

test('blocks browser printing, reloads and default menus without swallowing app input', async ({
    authedPage: page,
}) => {
    await page.route('http://127.0.0.1:9999/**', (route) => route.fulfill({ json: { connected: false } }));
    const probe = async (target: 'input' | 'div') =>
        page.evaluate((tag) => {
            const element = document.createElement(tag);
            document.body.append(element);
            const accepted = (key: string, modifiers: KeyboardEventInit = {}) =>
                element.dispatchEvent(
                    new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...modifiers }),
                );
            let appMenuCalled = false;
            element.addEventListener('contextmenu', () => {
                appMenuCalled = true;
            });
            const menuAllowed = element.dispatchEvent(
                new MouseEvent('contextmenu', { bubbles: true, cancelable: true }),
            );
            const result = {
                ctrlPrint: accepted('p', { ctrlKey: true }),
                metaPrint: accepted('P', { metaKey: true }),
                ctrlReload: accepted('r', { ctrlKey: true }),
                metaReload: accepted('R', { metaKey: true }),
                ctrlHardReload: accepted('R', { ctrlKey: true, shiftKey: true }),
                metaHardReload: accepted('R', { metaKey: true, shiftKey: true }),
                metaAltReload: accepted('r', { metaKey: true, altKey: true }),
                nonLatinReload: accepted('ㄱ', { code: 'KeyR', ctrlKey: true }),
                f5: accepted('F5'),
                ctrlF5: accepted('F5', { ctrlKey: true }),
                shiftF5: accepted('F5', { shiftKey: true }),
                browserRefresh: accepted('BrowserRefresh'),
                plainP: accepted('p'),
                plainR: accepted('r'),
                altGrR: accepted('ŗ', { code: 'KeyR', ctrlKey: true, altKey: true }),
                copy: accepted('c', { ctrlKey: true }),
                drop: accepted('D', { ctrlKey: true, shiftKey: true }),
                menuAllowed,
                appMenuCalled,
            };
            element.remove();
            return result;
        }, target);

    for (const view of ['dashboard', 'roast', 'history']) {
        await goNav(page, view);
        for (const target of ['input', 'div'] as const) {
            expect(await probe(target)).toEqual({
                ctrlPrint: false,
                metaPrint: false,
                ctrlReload: false,
                metaReload: false,
                ctrlHardReload: false,
                metaHardReload: false,
                metaAltReload: false,
                nonLatinReload: false,
                f5: false,
                ctrlF5: false,
                shiftF5: false,
                browserRefresh: false,
                plainP: true,
                plainR: true,
                altGrR: true,
                copy: true,
                drop: true,
                menuAllowed: false,
                appMenuCalled: true,
            });
        }
    }

    const navigated = page
        .waitForEvent('framenavigated', { predicate: (frame) => frame === page.mainFrame(), timeout: 1000 })
        .then(
            () => true,
            () => false,
        );
    for (const shortcut of ['Control+r', 'Control+Shift+r', 'Meta+r', 'Meta+Shift+r', 'F5', 'Control+F5']) {
        await page.keyboard.press(shortcut);
    }
    expect(await navigated).toBe(false);
});
