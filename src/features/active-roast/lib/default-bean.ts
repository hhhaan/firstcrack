import { logger } from '@shared/lib/logger';
import { settingsSet } from '@shared/lib/settings-store';

export const DEFAULT_BEAN_KEY = 'roast.defaultBeanId';
const LEGACY_KEY = 'fc_default_bean_id';

export function readDefaultBeanId(): string | null {
    try {
        return localStorage.getItem(DEFAULT_BEAN_KEY) || localStorage.getItem(LEGACY_KEY) || null;
    } catch (err) {
        logger.capture(err, { scope: 'defaultBean.read' });
        return null;
    }
}

export function persistDefaultBeanId(id: string | null): void {
    try {
        if (id) localStorage.setItem(DEFAULT_BEAN_KEY, id);
        else localStorage.removeItem(DEFAULT_BEAN_KEY);
        localStorage.removeItem(LEGACY_KEY);
    } catch (err) {
        logger.capture(err, { scope: 'defaultBean.persistLocal' });
    }
    void settingsSet(DEFAULT_BEAN_KEY, id);
}
