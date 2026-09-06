import type { RoastPhase } from '../model/status';

/** Cmd+R / Ctrl+R / F5 — webview reload shortcuts. */
export function isReloadShortcut(e: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey'>): boolean {
    if (e.key === 'F5') return true;
    return (e.key === 'r' || e.key === 'R') && (e.metaKey || e.ctrlKey);
}

/** Live roast is RAM — reload would drop beans-in-drum state. */
export function shouldBlockReload(phase: RoastPhase): boolean {
    return phase === 'roasting';
}
