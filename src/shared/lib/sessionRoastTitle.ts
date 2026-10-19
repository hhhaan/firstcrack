import { sessionBeanName } from './sessionBeanName';

/** Roast identity is independent of the linked inventory bean. Preserve legacy display titles. */
export const sessionRoastTitle = (
    session: Parameters<typeof sessionBeanName>[0] & { batch_name?: string | null },
): string | null =>
    session.batch_name?.trim() || session.bean_label?.trim() || sessionBeanName(session)?.trim() || null;
