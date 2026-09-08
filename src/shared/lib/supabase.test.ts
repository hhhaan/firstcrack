import { describe, expect, it } from 'vitest';
import { createBrowserSupabase, MISSING_SUPABASE_ENV } from './supabase';

describe('createBrowserSupabase', () => {
    it('does not call createClient when the URL is missing', () => {
        const { configured, client } = createBrowserSupabase({
            VITE_SUPABASE_URL: '',
            VITE_SUPABASE_ANON_KEY: 'anon-key',
        });

        expect(configured).toBe(false);
        expect(() => client.from('beans')).toThrow(MISSING_SUPABASE_ENV);
    });

    it('treats whitespace-only URL or key as missing', () => {
        expect(
            createBrowserSupabase({
                VITE_SUPABASE_URL: '   ',
                VITE_SUPABASE_ANON_KEY: 'anon-key',
            }).configured,
        ).toBe(false);
        expect(
            createBrowserSupabase({
                VITE_SUPABASE_URL: 'https://example.supabase.co',
                VITE_SUPABASE_ANON_KEY: '  ',
            }).configured,
        ).toBe(false);
    });

    it('creates a client when both URL and key are set', () => {
        const { configured, client } = createBrowserSupabase({
            VITE_SUPABASE_URL: 'https://example.supabase.co',
            VITE_SUPABASE_ANON_KEY: 'anon-key',
        });

        expect(configured).toBe(true);
        expect(typeof client.from).toBe('function');
    });
});
