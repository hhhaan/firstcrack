import { observeRoastingImportScan } from '@shared/lib/sentry';
import { useQuery } from '@tanstack/react-query';
import { invoke } from '@tauri-apps/api/core';
import { z } from 'zod';

const snapshot = z.object({
    status: z.enum(['found', 'not-found', 'needs-app-closed', 'unsupported', 'unreadable']),
    reason: z.string().optional(),
    source: z.object({
        product: z.literal('Cropster'),
        version: z.string().nullable(),
        sourceId: z.literal('default'),
    }),
    machine: z.record(z.unknown()).nullable(),
    preferences: z.record(z.unknown()).nullable(),
});
export const cropsterSettingsKey = ['local-roasting-settings', 'cropster'] as const;
export const useCropsterSettings = (enabled = true) =>
    useQuery({
        queryKey: cropsterSettingsKey,
        enabled,
        queryFn: async () => {
            const data = snapshot.parse(await invoke('read_cropster_settings'));
            observeRoastingImportScan({
                status: data.status,
                reason: data.reason,
                source: { product: data.source.product, version: data.source.version },
            });
            return data;
        },
        retry: false,
        throwOnError: false,
    });
