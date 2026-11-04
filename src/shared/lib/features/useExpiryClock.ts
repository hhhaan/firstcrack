import { useEffect, useState } from 'react';

/** Re-evaluate a time gate while the desktop stays open; no polling or network work. */
export function useExpiryClock(endsAt?: string | null) {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        if (!endsAt) return;
        if (new Date(endsAt).getTime() <= now) return;
        const remaining = new Date(endsAt).getTime() - Date.now();
        if (!Number.isFinite(remaining)) return;
        const timer = setTimeout(() => setNow(Date.now()), Math.max(1, Math.min(remaining + 1, 2_147_483_647)));
        return () => clearTimeout(timer);
    }, [endsAt, now]);
    return now;
}
