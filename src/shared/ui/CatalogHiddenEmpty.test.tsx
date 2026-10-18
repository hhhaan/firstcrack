import { beanDetailEmptyMessageKey, beanListEmptyMessageKey } from '@shared/ui/CatalogHiddenEmpty';
import { describe, expect, it } from 'vitest';

describe('catalog empty message keys', () => {
    it('beanListEmptyMessageKey', () => {
        expect(beanListEmptyMessageKey(2, 0)).toBe('beanList.allHidden');
        expect(beanListEmptyMessageKey(0, 0)).toBe('beanList.empty');
        expect(beanListEmptyMessageKey(0, 1)).toBe('beanList.noResults');
    });

    it('beanDetailEmptyMessageKey', () => {
        expect(beanDetailEmptyMessageKey(true, true)).toBe('beanDetail.empty.allHidden');
        expect(beanDetailEmptyMessageKey(false, true)).toBe('beanDetail.empty.select');
        expect(beanDetailEmptyMessageKey(false, false)).toBe('beanDetail.empty.addFirst');
    });
});
