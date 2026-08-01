import { platform } from '@tauri-apps/plugin-os';

/** Apple platforms use ⌘; Windows/Linux use Ctrl. */
export const isAppleOs = (): boolean => {
    try {
        const p = platform();
        return p === 'macos' || p === 'ios';
    } catch {
        if (typeof navigator === 'undefined') return false;
        return /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent);
    }
};
