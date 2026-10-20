/** Display name for a session: inventory bean join wins, then free-text label. */
export const sessionBeanName = (s: {
    beans?: { name: string } | null;
    blends?: { name: string } | null;
    bean_label?: string | null;
}): string | null => s.blends?.name ?? s.beans?.name ?? s.bean_label ?? null;
