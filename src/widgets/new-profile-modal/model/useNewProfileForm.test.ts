import type { RoastProfileWithSource } from '@entities/roast-profile';
import { describe, expect, it } from 'vitest';
import { INITIAL_PROFILE_FORM } from '../lib/types';
import { resolveNewProfileFormState } from './useNewProfileForm';

const editing = {
    id: 'p1',
    name: 'QA Smoke 0917',
    description: 'leftover',
    target_level: 'Medium-Light',
    source_session_id: 's1',
    default_bean_id: 'bean-1',
    default_blend_id: null,
} as RoastProfileWithSource;

describe('resolveNewProfileFormState (#471)', () => {
    it('a new draft starts with the session picker', () => {
        expect(resolveNewProfileFormState(null)).toEqual({
            mode: 'session-list',
            form: INITIAL_PROFILE_FORM,
            selectedSessionId: null,
            sources: [],
        });
    });

    it('open create starts on the session picker', () => {
        expect(resolveNewProfileFormState().mode).toBe('session-list');
        expect(resolveNewProfileFormState().form).toEqual(INITIAL_PROFILE_FORM);
    });

    it('open edit hydrates from the selected profile', () => {
        expect(resolveNewProfileFormState(editing)).toEqual({
            mode: 'from-session',
            form: {
                name: 'QA Smoke 0917',
                description: 'leftover',
                target_level: 'Medium-Light',
            },
            selectedSessionId: 's1',
            sources: [{ bean_id: 'bean-1', blend_id: null }],
        });
    });

    it('preserves a legacy default when an older client has no registered source rows', () => {
        expect(resolveNewProfileFormState({ ...editing, sources: [] }).sources).toEqual([
            { bean_id: 'bean-1', blend_id: null },
        ]);
    });

    it('hydrates all registered single-origin and blend sources', () => {
        const sources = [
            { bean_id: 'bean-1', blend_id: null },
            { bean_id: null, blend_id: 'blend-1' },
        ];
        expect(resolveNewProfileFormState({ ...editing, sources }).sources).toEqual(sources);
    });

    it('close after edit also clears so the next create is clean', () => {
        expect(resolveNewProfileFormState(null).mode).toBe('session-list');
        expect(resolveNewProfileFormState(null).form).toEqual(INITIAL_PROFILE_FORM);
        expect(resolveNewProfileFormState(null).selectedSessionId).toBeNull();
    });
});
