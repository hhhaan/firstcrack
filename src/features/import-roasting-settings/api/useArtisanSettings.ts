import { useQuery } from '@tanstack/react-query';
import { invoke } from '@tauri-apps/api/core';
import { z } from 'zod';

const snapshot = z.object({
    status: z.enum(['found', 'not-found', 'needs-app-closed', 'unsupported', 'unreadable']),
    reason: z.string().optional(),
    source: z.object({ product: z.literal('Artisan'), version: z.string().nullable(), sourceId: z.literal('native') }),
    settings: z.record(z.unknown()).nullable(),
});

export const artisanSettingsKey = ['local-roasting-settings', 'artisan'] as const;

export const useArtisanSettings = (enabled = true) =>
    useQuery({
        queryKey: artisanSettingsKey,
        enabled,
        queryFn: async () => snapshot.parse(await invoke('read_artisan_settings')),
        retry: false,
        throwOnError: false,
    });
