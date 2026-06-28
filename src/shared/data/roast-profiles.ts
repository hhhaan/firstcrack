/** BT 커브를 30초 간격으로 생성. dropTemp와 총 duration(초)를 기반으로 계산. */
export const generateProfileCurve = (dropTemp: number, duration: number): { t: number; bt: number }[] => {
    const points: { t: number; bt: number }[] = [];
    for (let t = 0; t <= duration; t += 30) {
        let bt: number;
        if (t <= 90) {
            bt = 200 - (48 * t) / 90;
        } else {
            const remaining = duration - 90;
            const rise = dropTemp - 152;
            const elapsed = t - 90;
            bt = 152 + rise * (elapsed / remaining) ** 0.75;
        }
        points.push({ t, bt: Math.round(bt * 10) / 10 });
    }
    return points;
};

/** 시간(초)에 대한 BT를 선형 보간으로 반환 */
export const interpolateProfileBT = (curve: { t: number; bt: number }[], timeSec: number): number | null => {
    if (curve.length === 0) return null;
    if (timeSec <= curve[0].t) return curve[0].bt;
    if (timeSec >= curve[curve.length - 1].t) return curve[curve.length - 1].bt;
    for (let i = 0; i < curve.length - 1; i++) {
        const lo = curve[i];
        const hi = curve[i + 1];
        if (lo.t <= timeSec && timeSec <= hi.t) {
            const ratio = (timeSec - lo.t) / (hi.t - lo.t);
            return lo.bt + ratio * (hi.bt - lo.bt);
        }
    }
    return null;
};
