import { describe, expect, it } from 'vitest';
import { canSubmitManualOrder, createManualOrderPlatformId, isManualOrderPlatformId } from './submit';

describe('createManualOrderPlatformId', () => {
    it('returns a stable UUID, not a Date.now() key', () => {
        const id = createManualOrderPlatformId();
        expect(isManualOrderPlatformId(id)).toBe(true);
        expect(id.startsWith('manual-')).toBe(false);
        expect(id).not.toMatch(/^manual-\d+$/);
    });

    it('uses the injected factory so retries can reuse one key', () => {
        expect(createManualOrderPlatformId(() => '11111111-1111-4111-8111-111111111111')).toBe(
            '11111111-1111-4111-8111-111111111111',
        );
    });
});

describe('canSubmitManualOrder', () => {
    it('blocks submit while pending even when the form is valid', () => {
        expect(canSubmitManualOrder({ valid: true, isPending: true })).toBe(false);
    });

    it('blocks invalid drafts', () => {
        expect(canSubmitManualOrder({ valid: false, isPending: false })).toBe(false);
    });

    it('allows a single submit when valid and idle', () => {
        expect(canSubmitManualOrder({ valid: true, isPending: false })).toBe(true);
    });
});
