import { locationStore } from '@shared/lib/locationStore';
import { weatherKeys } from '@shared/lib/query-keys';
import { useQuery } from '@tanstack/react-query';

const WEATHER_TTL = 30 * 60 * 1000;

export interface WeatherData {
    temperature: number;
    humidity: number;
}

const fetchOpenMeteo = async (lat: number, lng: number): Promise<WeatherData> => {
    const res = await fetch(
        `https://api.open-meteo.com/v1/forecast` +
            `?latitude=${lat}&longitude=${lng}` +
            `&current=temperature_2m,relative_humidity_2m`,
    );
    if (!res.ok) throw new Error('weather fetch failed');
    const json = await res.json();
    return {
        temperature: Math.round(json.current.temperature_2m),
        humidity: Math.round(json.current.relative_humidity_2m),
    };
};

/** Unset location is empty, not a query error — QueryCache.onError reports throws to Sentry. */
export const fetchWeatherCoords = async () => (await locationStore.get()) ?? null;

export const useWeather = () => {
    const coords = useQuery({
        queryKey: weatherKeys.coords,
        queryFn: fetchWeatherCoords,
        staleTime: Infinity,
    });

    const weather = useQuery({
        queryKey: weatherKeys.current(coords.data?.lat, coords.data?.lng),
        // biome-ignore lint/style/noNonNullAssertion: enabled when coords.data is set
        queryFn: () => fetchOpenMeteo(coords.data!.lat, coords.data!.lng),
        enabled: !!coords.data,
        staleTime: WEATHER_TTL,
        retry: 1,
    });

    return {
        data: weather.data ?? null,
        loading: coords.isLoading || weather.isLoading,
    };
};
