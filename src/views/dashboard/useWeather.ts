import { useQuery } from '@tanstack/react-query';

const GEO_TTL = 24 * 60 * 60 * 1000;
const WEATHER_TTL = 30 * 60 * 1000;

export interface WeatherData {
    temperature: number;
    humidity: number;
    city: string;
}

interface GeoCoords {
    lat: number;
    lon: number;
    city: string;
}

const fetchGeo = async (): Promise<GeoCoords> => {
    const res = await fetch('http://ip-api.com/json/?fields=lat,lon,city');
    if (!res.ok) throw new Error('geo fetch failed');
    const json = await res.json();
    return { lat: json.lat, lon: json.lon, city: json.city ?? '' };
};

const fetchOpenMeteo = async (lat: number, lon: number, city: string): Promise<WeatherData> => {
    const res = await fetch(
        `https://api.open-meteo.com/v1/forecast` +
        `?latitude=${lat}&longitude=${lon}` +
        `&current=temperature_2m,relative_humidity_2m`,
    );
    if (!res.ok) throw new Error('weather fetch failed');
    const json = await res.json();
    return {
        temperature: Math.round(json.current.temperature_2m),
        humidity: Math.round(json.current.relative_humidity_2m),
        city,
    };
};

export const useWeather = () => {
    const geo = useQuery({
        queryKey: ['weather', 'geo'],
        queryFn: fetchGeo,
        staleTime: GEO_TTL,
        retry: 1,
    });

    const weather = useQuery({
        queryKey: ['weather', 'current', geo.data?.lat, geo.data?.lon],
        queryFn: () => fetchOpenMeteo(geo.data!.lat, geo.data!.lon, geo.data!.city),
        enabled: !!geo.data,
        staleTime: WEATHER_TTL,
        retry: 1,
    });

    return {
        data: weather.data ?? null,
        loading: geo.isLoading || weather.isLoading,
    };
};
