import { createDevicePreference } from '@shared/lib/device-preference';
import { useMemo } from 'react';

type Catalog = 'beans' | 'profiles';
type HiddenCatalog = Record<string, { beans: string[]; profiles: string[] }>;
const normalize = (raw: unknown): HiddenCatalog => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    return Object.fromEntries(
        Object.entries(raw).map(([scope, row]) => {
            const data = row && typeof row === 'object' ? (row as Record<string, unknown>) : {};
            const ids = (value: unknown) =>
                Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === 'string'))] : [];
            return [scope, { beans: ids(data.beans), profiles: ids(data.profiles) }];
        }),
    );
};
const preference = createDevicePreference<HiddenCatalog>('catalog.hidden', {}, normalize);
const EMPTY_IDS: string[] = [];
export const useCatalogVisibility = (userId: string, ownerId: string, catalog: Catalog) => {
    const data = preference.useValue();
    const scope = JSON.stringify([userId, ownerId]);
    const hiddenIds = data[scope]?.[catalog] ?? EMPTY_IDS;
    const hidden = useMemo(() => new Set(hiddenIds), [hiddenIds]);
    const setHidden = (id: string, next: boolean) => {
        if (!userId || !ownerId) return;
        const current = preference.get();
        const row = current[scope] ?? { beans: [], profiles: [] };
        const ids = row[catalog];
        preference.update({
            ...current,
            [scope]: { ...row, [catalog]: next ? [...new Set([...ids, id])] : ids.filter((item) => item !== id) },
        });
    };
    return { hidden, setHidden };
};
