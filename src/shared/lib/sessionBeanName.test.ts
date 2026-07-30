import { describe, expect, it } from 'vitest';
import { sessionBeanName } from './sessionBeanName';

describe('sessionBeanName', () => {
    it('prefers inventory join name over label', () => {
        expect(sessionBeanName({ beans: { name: 'Yirg' }, bean_label: 'Sample' })).toBe('Yirg');
    });

    it('falls back to free-text label', () => {
        expect(sessionBeanName({ beans: null, bean_label: 'Sample Lot' })).toBe('Sample Lot');
    });

    it('returns null when neither is set', () => {
        expect(sessionBeanName({ beans: null, bean_label: null })).toBeNull();
    });
});
