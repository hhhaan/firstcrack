/**
 * The single write path for rotated channel credentials.
 *
 * Cafe24 revokes the previous refresh_token every time a new one is minted, so a rotation that
 * only lives in an adapter's local variable permanently bricks the connection. Every caller that
 * hands secrets to an adapter builds a session and passes `rotate` as the adapter's rotation sink;
 * nobody else updates `sales_channel_secrets`.
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import type { ChannelSecrets, SecretsRotationSink } from './types.ts';

export interface SecretsSession {
    /** Latest known credentials — always pass these to the next adapter call. */
    current(): ChannelSecrets;
    /** Merge + persist a rotation, then keep serving the new value from `current()`. */
    rotate: SecretsRotationSink;
}

export function createSecretsSession(
    supabase: SupabaseClient,
    connectionId: string,
    initial: ChannelSecrets,
): SecretsSession {
    let secrets = initial;

    return {
        current: () => secrets,
        rotate: async (rotated) => {
            const merged = { ...secrets, ...rotated };
            const { error } = await supabase
                .from('sales_channel_secrets')
                .update({ credentials: merged, updated_at: new Date().toISOString() })
                .eq('connection_id', connectionId);
            // A dropped rotation leaves a revoked token in the DB → fail loudly instead of
            // continuing with credentials the platform has already invalidated.
            if (error) throw new Error(`secrets rotate failed: ${error.message}`);
            secrets = merged;
        },
    };
}

/** Service-role load; throws when the connection has no stored credentials. */
export async function loadSecretsSession(
    supabase: SupabaseClient,
    connectionId: string,
): Promise<SecretsSession> {
    const { data, error } = await supabase
        .from('sales_channel_secrets')
        .select('credentials')
        .eq('connection_id', connectionId)
        .single();
    if (error || !data) throw new Error('secrets not found');
    return createSecretsSession(supabase, connectionId, data.credentials as ChannelSecrets);
}
