/**
 * Injected before app loads — stubs Tauri plugins so the real Vite entry works in Chromium.
 */
import type { Page } from '@playwright/test';

export const tauriInitScript = `
(() => {
  window.isTauri = true;
  window.__TAURI_OS_PLUGIN_INTERNALS__ = {
    platform: 'macos',
    family: 'unix',
    os_type: 'macos',
    arch: 'aarch64',
    version: '15.0.0',
    eol: '\\n',
    exe_extension: '',
  };
  window.__TAURI_INTERNALS__ = {
    metadata: {
      currentWindow: { label: 'main' },
      currentWebview: { windowLabel: 'main', label: 'main' },
    },
    invoke: async function (cmd) {
      const mock = window['__e2e_' + cmd];
      if (typeof mock === 'function') return mock();
      if (cmd === 'plugin:dialog|message' || cmd === 'plugin:dialog|ask' || cmd === 'plugin:dialog|confirm') {
        return true;
      }
      if (cmd === 'plugin:store|get' || cmd === 'plugin:store|set' || cmd === 'plugin:store|save') return null;
      if (cmd === 'plugin:os|locale') return 'en-US';
      if (cmd === 'plugin:fs|write_text_file' || cmd === 'plugin:fs|read_text_file' || cmd === 'plugin:fs|remove') return null;
      if (cmd === 'plugin:event|listen') return function () {};
      if (cmd === 'plugin:window|set_title') return null;
      if (typeof cmd === 'string' && cmd.indexOf('plugin:window') === 0) return null;
      return null;
    },
    transformCallback: function (cb) {
      const id = Math.floor(Math.random() * 1e9);
      window['_' + id] = cb;
      return id;
    },
    unregisterCallback: function () {},
  };
  try { localStorage.setItem('fc_theme', 'light'); } catch (e) {}
  try { localStorage.setItem('fc.language', 'en'); } catch (e) {}
  // Skip Active Roast spotlight tour (blocks clicks in e2e)
  try {
    localStorage.setItem(
      'fc_active_roast_onboarding',
      JSON.stringify({ state: { fullscreenHintSeen: true, sessionDismissed: false }, version: 0 })
    );
  } catch (e) {}
})();
`;

export const mockTauriCommand = (page: Page, command: string, handler: () => unknown | Promise<unknown>) =>
    page.exposeFunction(`__e2e_${command}`, handler);
