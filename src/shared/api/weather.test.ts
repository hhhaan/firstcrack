import { locationStore } from '@shared/lib/locationStore';
import { QueryCache, QueryClient } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchWeatherCoords } from './weather';

vi.mock('@shared/lib/locationStore', () => ({
    locationStore: { get: vi.fn() },
}));

const getCoords = vi.mocked(locationStore.get);

describe('fetchWeatherCoords', () => {
    beforeEach(() => {
        getCoords.mockReset();
    });

    it('returns null without throwing when location is unset (FC-19 / FC-C)', async () => {
        getCoords.mockResolvedValue(undefined);
        const onError = vi.fn();
        const qc = new QueryClient({
            queryCache: new QueryCache({ onError }),
            defaultOptions: { queries: { retry: false } },
        });

        await expect(
            qc.fetchQuery({ queryKey: ['weather', 'coords'], queryFn: fetchWeatherCoords }),
        ).resolves.toBeNull();
        expect(onError).not.toHaveBeenCalled();
        qc.clear();
    });

    it('returns saved coords', async () => {
        getCoords.mockResolvedValue({ lat: 37.5, lng: 127 });
        await expect(fetchWeatherCoords()).resolves.toEqual({ lat: 37.5, lng: 127 });
    });
});
