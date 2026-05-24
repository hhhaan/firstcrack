export interface TsvPoint {
    t: number;
    bt: number;
    et: number | null;
    ror: number | null;
}

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
        const et = cols[2] ? parseFloat(cols[2]) : NaN;
        const ror = cols[3] ? parseFloat(cols[3]) : NaN;
        points.push({
            t,
            bt,
            et: Number.isFinite(et) ? et : null,
            ror: Number.isFinite(ror) ? ror : null,
        });
    }
    return points;
};
