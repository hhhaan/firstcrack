import { useQuery } from '@tanstack/react-query';
import { invoke } from '@tauri-apps/api/core';
import { z } from 'zod';

const snapshot = z.object({
    status: z.enum(['found', 'not-found', 'needs-app-closed', 'unsupported', 'unreadable']),
    reason: z.string().optional(),
    source: z.object({ product: z.literal('Firescope'), version: z.string().nullable() }),
    graphTemperatureUnit: z.string().nullable(),
    graph: z.record(z.unknown()).nullable(),
    indicator: z.record(z.unknown()).nullable(),
    global: z.record(z.unknown()).nullable(),
    machines: z
        .array(
            z.object({
                sequence: z.number().int().nonnegative(),
                current: z.boolean(),
                settings: z.record(z.unknown()),
            }),
        )
        .max(256),
});

export const firescopeSettingsKey = ['local-roasting-settings', 'firescope'] as const;

export const useFirescopeSettings = (enabled = true) =>
    useQuery({
        queryKey: firescopeSettingsKey,
        enabled,
        queryFn: async () => snapshot.parse(await invoke('read_firescope_settings')),
        retry: false,
        throwOnError: false,
    });
