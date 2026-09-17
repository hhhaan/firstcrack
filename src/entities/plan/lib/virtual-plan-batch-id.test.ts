import { describe, expect, it } from 'vitest';
import { isUuid, parseVirtualPlanBatchId } from './virtual-plan-batch-id';

const RULE = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

describe('isUuid', () => {
    it('accepts canonical uuid only', () => {
        expect(isUuid(RULE)).toBe(true);
        expect(isUuid(RULE.toUpperCase())).toBe(true);
        expect(isUuid('batch-1')).toBe(false);
        expect(isUuid(`${RULE}:2026-09-01`)).toBe(false);
    });
});

describe('parseVirtualPlanBatchId', () => {
    it('accepts only UUID:YYYY-MM-DD with a date that round-trips', () => {
        expect(parseVirtualPlanBatchId(`${RULE}:2026-09-01`)).toEqual({
            ruleId: RULE,
            originalDate: '2026-09-01',
        });
    });

    it('rejects includes(":") lookalikes and non-round-trip dates', () => {
        expect(parseVirtualPlanBatchId('rule-1:2026-09-01')).toBeNull();
        expect(parseVirtualPlanBatchId(`${RULE}:2026-02-30`)).toBeNull();
        expect(parseVirtualPlanBatchId(`${RULE}:2026-13-01`)).toBeNull();
        expect(parseVirtualPlanBatchId(`${RULE}:20260901`)).toBeNull();
        expect(parseVirtualPlanBatchId(`${RULE}:2026-9-1`)).toBeNull();
        expect(parseVirtualPlanBatchId(`${RULE}:${RULE}`)).toBeNull();
        expect(parseVirtualPlanBatchId(`${RULE}:2026-09-01:extra`)).toBeNull();
        expect(parseVirtualPlanBatchId(RULE)).toBeNull();
        expect(parseVirtualPlanBatchId('optimistic-id')).toBeNull();
    });
});
