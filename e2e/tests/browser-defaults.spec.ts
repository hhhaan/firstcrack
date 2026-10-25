import { expect, goNav, test } from '../fixtures/app';

test('blocks browser actions and unapproved right-click handlers without swallowing app input', async ({
    authedPage: page,
}) => {
    await page.route('http://127.0.0.1:9999/**', (route) => route.fulfill({ json: { connected: false } }));
    const isMac = await page.evaluate(() => navigator.platform.toLowerCase().includes('mac'));
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
                browserBack: accepted('BrowserBack'),
                browserForward: accepted('BrowserForward'),
                altBack: accepted('ArrowLeft', { altKey: true }),
                altForward: accepted('ArrowRight', { altKey: true }),
                devtools: accepted('F12'),
                inspect: accepted('i', { ctrlKey: true, shiftKey: true }),
                macInspect: accepted('i', { metaKey: true, altKey: true }),
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
                browserBack: false,
                browserForward: false,
                altBack: target === 'input' && isMac,
                altForward: target === 'input' && isMac,
                devtools: false,
                inspect: false,
                macInspect: false,
                plainP: true,
                plainR: true,
                altGrR: true,
                copy: true,
                drop: true,
                menuAllowed: false,
                appMenuCalled: false,
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

test('blocks right-click, side buttons and dropped documents before app handlers', async ({ authedPage: page }) => {
    await page.route('http://127.0.0.1:9999/**', (route) => route.fulfill({ json: { connected: false } }));
    const results = await page.evaluate(() => {
        const target = document.createElement('div');
        document.body.append(target);
        const probe = (type: string, button: number) => {
            let called = false;
            target.addEventListener(
                type,
                () => {
                    called = true;
                },
                { once: true },
            );
            const accepted = target.dispatchEvent(new MouseEvent(type, { button, bubbles: true, cancelable: true }));
            return { accepted, called };
        };
        const rightClick = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'auxclick', 'contextmenu'].map(
            (type) => probe(type, 2),
        );
        const back = probe('mouseup', 3);
        const forward = probe('auxclick', 4);
        const left = probe('click', 0);
        const dropped = ['dragover', 'drop'].map((type) => probe(type, 0));
        target.remove();
        return { rightClick, back, forward, left, dropped };
    });
    for (const result of [...results.rightClick, results.back, results.forward, ...results.dropped]) {
        expect(result).toEqual({ accepted: false, called: false });
    }
    expect(results.left).toEqual({ accepted: true, called: true });
});

test('allows graph application context menus while blocking native menus and side buttons', async ({
    authedPage: page,
}) => {
    await page.route('http://127.0.0.1:9999/**', (route) => route.fulfill({ json: { connected: false } }));
    await goNav(page, 'roast');
    const chart = page.locator('[data-app-context-menu]').first();
    await expect(chart).toBeVisible();
    const results = await chart.evaluate((surface) => {
        const target = document.createElement('div');
        surface.append(target);
        const probe = (type: string, button: number) => {
            let called = false;
            const handler = () => {
                called = true;
            };
            target.addEventListener(type, handler);
            const accepted = target.dispatchEvent(new MouseEvent(type, { button, bubbles: true, cancelable: true }));
            target.removeEventListener(type, handler);
            return { accepted, called };
        };
        const rightClick = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'auxclick'].map((type) =>
            probe(type, 2),
        );
        const contextmenu = probe('contextmenu', 2);
        const back = probe('mouseup', 3);
        const forward = probe('auxclick', 4);
        target.remove();
        return { rightClick, contextmenu, back, forward };
    });
    for (const result of results.rightClick) expect(result).toEqual({ accepted: true, called: true });
    expect(results.contextmenu).toEqual({ accepted: false, called: true });
    expect(results.back).toEqual({ accepted: false, called: false });
    expect(results.forward).toEqual({ accepted: false, called: false });
});
