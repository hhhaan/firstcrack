/**
 * Injected before app loads — stubs Tauri plugins so the real Vite entry works in Chromium.
 */
export const tauriInitScript = `
(() => {
  window.__TAURI_INTERNALS__ = {
    metadata: {
      currentWindow: { label: 'main' },
      currentWebview: { windowLabel: 'main', label: 'main' },
    },
    invoke: async function (cmd, args) {
      if (cmd === 'plugin:dialog|message') {
        var buttons = args && args.buttons;
        if (typeof buttons === 'string') {
          if (buttons === 'YesNo') return 'Yes';
          if (buttons === 'OkCancel') return 'Ok';
          return 'Ok';
        }
        if (buttons && typeof buttons === 'object') {
          if (buttons.OkCancelCustom) return buttons.OkCancelCustom[0];
          if (buttons.OkCustom) return buttons.OkCustom;
          if (buttons.YesNoCancelCustom) return buttons.YesNoCancelCustom[0];
        }
        return 'Ok';
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
