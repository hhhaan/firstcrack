import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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
    it('close/unmount returns the session picker, not leftover create values', () => {
        expect(resolveNewProfileFormState(false, null)).toEqual({
            mode: 'session-list',
            form: INITIAL_PROFILE_FORM,
            selectedSessionId: null,
            sources: [],
        });
    });

    it('open create starts on the session picker', () => {
        expect(resolveNewProfileFormState(true, null).mode).toBe('session-list');
        expect(resolveNewProfileFormState(true, null).form).toEqual(INITIAL_PROFILE_FORM);
    });

    it('open edit hydrates from the selected profile', () => {
        expect(resolveNewProfileFormState(true, editing)).toEqual({
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
        expect(resolveNewProfileFormState(true, { ...editing, sources: [] }).sources).toEqual([
            { bean_id: 'bean-1', blend_id: null },
        ]);
    });

    it('hydrates all registered single-origin and blend sources', () => {
        const sources = [
            { bean_id: 'bean-1', blend_id: null },
            { bean_id: null, blend_id: 'blend-1' },
        ];
        expect(resolveNewProfileFormState(true, { ...editing, sources }).sources).toEqual(sources);
        expect(resolveNewProfileFormState(false, { ...editing, sources }).sources).toEqual([]);
    });

    it('close after edit also clears so the next create is clean', () => {
        expect(resolveNewProfileFormState(false, editing).mode).toBe('session-list');
        expect(resolveNewProfileFormState(false, editing).form).toEqual(INITIAL_PROFILE_FORM);
        expect(resolveNewProfileFormState(false, editing).selectedSessionId).toBeNull();
    });
});

describe('useNewProfileForm close reset wiring', () => {
    it('syncs form when open flips, including close — not only when opening', () => {
        const src = readFileSync(fileURLToPath(new URL('./useNewProfileForm.ts', import.meta.url)), 'utf8');
        expect(src).toContain('resolveNewProfileFormState(open, editingProfile)');
        expect(src).toMatch(/open !== prevOpen/);
        expect(src).not.toMatch(/if \(open && \(open !== prevOpen/);
    });
});
