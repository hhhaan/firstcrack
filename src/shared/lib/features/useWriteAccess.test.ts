import { resolveWorkspaceOwnerId } from '@shared/store/workspace';
import { describe, expect, it } from 'vitest';
import { resolveEffectivePlan } from './effective-plan';
import { isWritablePlan } from './plan-matrix';

/** Former non-trial branch: foreign workspace bypassed useEffectivePlan and read ownerPlanById again. */
function legacyNonTrialWriteAccess(input: {
    personalPlan: string;
    authUserId: string;
    activeOwnerId: string | null;
    ownerPlanById: Readonly<Record<string, string>>;
}): boolean {
    const plan = resolveEffectivePlan(input);
    const membershipOwnerIds = Object.keys(input.ownerPlanById);
    const workspaceOwnerId = resolveWorkspaceOwnerId(input.activeOwnerId, input.authUserId, membershipOwnerIds);
    const isForeignWorkspace = !!input.authUserId && !!workspaceOwnerId && workspaceOwnerId !== input.authUserId;
    if (isForeignWorkspace) {
        return isWritablePlan(input.ownerPlanById[workspaceOwnerId] ?? '');
    }
    if (!isWritablePlan(plan)) return false;
    return true;
}

function simplifiedNonTrialWriteAccess(input: {
    personalPlan: string;
    authUserId: string;
    activeOwnerId: string | null;
    ownerPlanById: Readonly<Record<string, string>>;
}): boolean {
    const plan = resolveEffectivePlan(input);
    if (!isWritablePlan(plan)) return false;
    return true;
}

describe('useWriteAccess non-trial equivalence', () => {
    const me = 'user-me';
    const owner = 'owner-ent';

    const cases = [
        { label: 'self free', personalPlan: 'free', activeOwnerId: null as string | null, ownerPlan: 'enterprise' },
        { label: 'self pro', personalPlan: 'pro', activeOwnerId: me, ownerPlan: 'enterprise' },
        { label: 'foreign enterprise', personalPlan: 'free', activeOwnerId: owner, ownerPlan: 'enterprise' },
        { label: 'foreign pro host', personalPlan: 'pro', activeOwnerId: owner, ownerPlan: 'pro' },
        { label: 'foreign missing host plan', personalPlan: 'pro', activeOwnerId: owner, ownerPlan: '' },
        { label: 'foreign read_only host', personalPlan: 'free', activeOwnerId: owner, ownerPlan: 'read_only' },
    ] as const;

    it.each(cases)('$label: simplified matches legacy foreign lookup', ({ personalPlan, activeOwnerId, ownerPlan }) => {
        const input = {
            personalPlan,
            authUserId: me,
            activeOwnerId,
            ownerPlanById: { [owner]: ownerPlan },
        };
        expect(simplifiedNonTrialWriteAccess(input)).toBe(legacyNonTrialWriteAccess(input));
    });
});
