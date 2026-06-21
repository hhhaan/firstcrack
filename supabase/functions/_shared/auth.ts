import { createClient } from 'npm:@supabase/supabase-js@2';

export const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

export const jsonResponse = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), {
        status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

export const getAuthenticatedUser = async (req: Request) => {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return null;

    const supabase = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_ANON_KEY') ?? '',
        { global: { headers: { Authorization: authHeader } } },
    );

    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) return null;
    return data.user;
};
