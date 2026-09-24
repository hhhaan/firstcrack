import { sidecar } from '@shared/lib/sidecar';
import type { SidecarStatus } from '@shared/types/sidecar';
import { useQuery } from '@tanstack/react-query';

export const sidecarStatusKey = ['sidecar', 'status'] as const;

export const fetchSidecarStatus = (): Promise<SidecarStatus> => sidecar.getStatus();

/** One-shot `/status` for heater bounds. No polling — each editor open is a fresh read. */
export const useSidecarStatus = (enabled: boolean) =>
    useQuery({
        queryKey: sidecarStatusKey,
        queryFn: fetchSidecarStatus,
        enabled,
        retry: false,
        staleTime: 0,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
    });
