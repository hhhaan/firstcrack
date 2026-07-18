import { describe, expect, it } from 'vitest';
import { resolveWorkspaceOwnerId } from './workspace';

// TDD red: workspace.ts 구현 전. 계약: null=본인, 멤버십에 없는 id(제거됨)=본인 폴백.
describe('resolveWorkspaceOwnerId', () => {
    const me = 'user-me';
    const other = 'owner-a';

    it('returns self when no active workspace is set', () => {
        expect(resolveWorkspaceOwnerId(null, me, [])).toBe(me);
        expect(resolveWorkspaceOwnerId(null, me, [other])).toBe(me);
    });

    it('returns self when active id is self', () => {
        expect(resolveWorkspaceOwnerId(me, me, [other])).toBe(me);
    });

    it('returns active owner when membership exists', () => {
        expect(resolveWorkspaceOwnerId(other, me, [other, 'owner-b'])).toBe(other);
    });

    it('falls back to self when membership was removed', () => {
        expect(resolveWorkspaceOwnerId(other, me, [])).toBe(me);
        expect(resolveWorkspaceOwnerId(other, me, ['owner-b'])).toBe(me);
    });
});
