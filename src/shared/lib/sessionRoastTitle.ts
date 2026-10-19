import { sessionBeanName } from './sessionBeanName';

/** Roast identity is independent of the linked inventory bean. Preserve legacy display titles. */
export const sessionRoastTitle = (
    session: Parameters<typeof sessionBeanName>[0] & { batch_name?: string | null },
): string | null =>
    session.batch_name?.trim() || session.bean_label?.trim() || sessionBeanName(session)?.trim() || null;

/**
 * Title worth showing as its own field (table cell, PDF row, CSV column).
 * Every untitled roast falls back to its bean name, so only a title that says something
 * the bean name does not is worth repeating — and free-text labels must not pose as beans.
 */
export const sessionDistinctTitle = (
    session: Parameters<typeof sessionBeanName>[0] & { batch_name?: string | null },
): string | null => {
    const title = sessionRoastTitle(session);
    if (!title) return null;
    const beanName = sessionBeanName(session)?.trim();
    return beanName && title.toLowerCase() === beanName.toLowerCase() ? null : title;
};
