import { describe, expect, it } from 'vitest';
import { isGreenRoastAlreadyClaimed } from './f3-green-deduct';

describe('isGreenRoastAlreadyClaimed (F3)', () => {
    it('blocks same reference retry', () => {
        expect(isGreenRoastAlreadyClaimed(['batch-1'], 'batch-1')).toBe(true);
    });

    it('blocks session deduct when linked batch already claimed', () => {
        expect(isGreenRoastAlreadyClaimed(['batch-1'], 'session-9', 'batch-1')).toBe(true);
    });

    it('allows session deduct when batch not claimed', () => {
        expect(isGreenRoastAlreadyClaimed([], 'session-9', 'batch-1')).toBe(false);
    });

    it('allows batch complete when only session claimed is unrelated', () => {
        expect(isGreenRoastAlreadyClaimed(['other-session'], 'batch-2', null)).toBe(false);
    });
});
