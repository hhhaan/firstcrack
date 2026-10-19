/** Second press inside this window marks Drop; key repeat never does. */
export const DROP_DOUBLE_TAP_MS = 400;
export function nextDropDoubleTap(armedAt: number | null, now: number, repeat: boolean) {
    if (repeat) return { armedAt, fire: false };
    if (armedAt != null && now >= armedAt && now - armedAt <= DROP_DOUBLE_TAP_MS) return { armedAt: null, fire: true };
    return { armedAt: now, fire: false };
}
