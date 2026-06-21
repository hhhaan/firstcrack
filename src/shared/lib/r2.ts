import { supabase } from '@shared/lib/supabase';

type PresignedUrlResponse = { url: string };

export const fetchTsvFromR2 = async (key: string): Promise<string> => {
    const { data, error } = await supabase.functions.invoke<PresignedUrlResponse>('get-download-url', {
        body: { key },
    });
    if (error) throw new Error(`Failed to get download URL: ${error.message}`);
    if (!data?.url) throw new Error('Failed to get download URL');

    const res = await fetch(data.url);
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`R2 download failed (${res.status})${text ? `: ${text}` : ''}`);
    }
    return res.text();
};

export const requestUploadUrl = async (sessionId: string): Promise<string> => {
    const { data, error } = await supabase.functions.invoke<PresignedUrlResponse>('get-upload-url', {
        body: { sessionId },
    });
    if (error) throw new Error(`Failed to get upload URL: ${error.message}`);
    if (!data?.url) throw new Error('Failed to get upload URL');
    return data.url;
};

export const profileKeyForUser = (userId: string, sessionId: string): string => `profiles/${userId}/${sessionId}.tsv`;
