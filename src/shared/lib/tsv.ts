export interface TsvPoint {
    t: number;
    bt: number;
    et: number | null;
    ror: number | null;
    heater: number | null;
    fan: number | null;
    drum: number | null;
}

const optionalCol = (raw: string | undefined): number | null => {
    if (!raw) return null;
    const n = parseFloat(raw);
    return Number.isFinite(n) ? n : null;
};

// TSV 형식 (useSidecarPolling.ts:21):
// time\tbt\tet\tror\theater\tfan\tdrum
// t는 charge 시점(=0) 기준 post-charge 상대 시간(초).
export const parseTsv = (text: string): TsvPoint[] => {
    const lines = text.split('\n');
    const points: TsvPoint[] = [];
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        if (!line) continue;
        const cols = line.split('\t');
        if (cols.length < 2) continue;
        const t = parseFloat(cols[0]);
        const bt = parseFloat(cols[1]);
        if (!Number.isFinite(t) || !Number.isFinite(bt)) continue;
        points.push({
            t,
            bt,
            et: optionalCol(cols[2]),
            ror: optionalCol(cols[3]),
            heater: optionalCol(cols[4]),
            fan: optionalCol(cols[5]),
            drum: optionalCol(cols[6]),
        });
    }
    return points;
};
