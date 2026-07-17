import { settingsGet, settingsSet } from './settings-store';

const KEY = 'roastery.location';

export interface RoasteryLocation {
    lat: number;
    lng: number;
}

export const parseLocationString = (str: string): RoasteryLocation | null => {
    const [rawLat, rawLng] = str.split(',');
    const lat = parseFloat(rawLat?.trim());
    const lng = parseFloat(rawLng?.trim());
    return !Number.isNaN(lat) && !Number.isNaN(lng) ? { lat, lng } : null;
};

export const locationStore = {
    get: () => settingsGet<RoasteryLocation>(KEY),
    set: async (loc: RoasteryLocation) => {
        await settingsSet(KEY, loc);
    },
};
