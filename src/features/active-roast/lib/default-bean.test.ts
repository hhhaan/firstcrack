// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockSettingsSet = vi.fn(async () => {});

vi.mock('@shared/lib/settings-store', () => ({
    settingsSet: mockSettingsSet,
}));

const { DEFAULT_BEAN_KEY, persistDefaultBeanId, readDefaultBeanId } = await import('./default-bean');

describe('default bean store key (#274)', () => {
    beforeEach(() => {
        localStorage.clear();
        mockSettingsSet.mockClear();
    });

    it('readDefaultBeanId prefers roast.defaultBeanId over legacy', () => {
        localStorage.setItem('fc_default_bean_id', 'legacy');
        localStorage.setItem(DEFAULT_BEAN_KEY, 'current');
        expect(readDefaultBeanId()).toBe('current');
    });

    it('readDefaultBeanId falls back to legacy fc_default_bean_id', () => {
        localStorage.setItem('fc_default_bean_id', 'legacy');
        expect(readDefaultBeanId()).toBe('legacy');
    });

    it('persistDefaultBeanId writes domain.field and drops legacy', () => {
        localStorage.setItem('fc_default_bean_id', 'legacy');
        persistDefaultBeanId('bean-1');
        expect(localStorage.getItem(DEFAULT_BEAN_KEY)).toBe('bean-1');
        expect(localStorage.getItem('fc_default_bean_id')).toBeNull();
        expect(mockSettingsSet).toHaveBeenCalledWith(DEFAULT_BEAN_KEY, 'bean-1');
    });

    it('persistDefaultBeanId(null) clears both keys', () => {
        localStorage.setItem(DEFAULT_BEAN_KEY, 'bean-1');
        localStorage.setItem('fc_default_bean_id', 'legacy');
        persistDefaultBeanId(null);
        expect(localStorage.getItem(DEFAULT_BEAN_KEY)).toBeNull();
        expect(localStorage.getItem('fc_default_bean_id')).toBeNull();
        expect(mockSettingsSet).toHaveBeenCalledWith(DEFAULT_BEAN_KEY, null);
    });
});
