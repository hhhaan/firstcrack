/** Display name for a session: inventory bean join wins, then free-text label. */
export const sessionBeanName = (s: { beans?: { name: string } | null; bean_label?: string | null }): string | null =>
    s.beans?.name ?? s.bean_label ?? null;
