export interface RoastProfile {
    id: number;
    name: string;
    description: string;
    duration: string;
    dropTemp: string;
    charge: number;
    dropVal: number;
    durationSec: number;
    charge_temp: number;
    devTime: string;
    devPct: string;
    usedFor: string[];
    locked: boolean;
    batches: number;
}

export const roastProfiles: RoastProfile[] = [
    {
        id: 1,
        name: 'Signature Light',
        description: 'High clarity light roast. Preserves origin characteristics.',
        duration: '11:30–12:30',
        dropTemp: '193–197°C',
        charge: 200,
        dropVal: 195,
        durationSec: 750,
        charge_temp: 200,
        devTime: '1:30–2:00',
        devPct: '12–15%',
        usedFor: ['Ethiopia Yirgacheffe', 'Kenya AA', 'Panama Gesha'],
        locked: false,
        batches: 34,
    },
    {
        id: 2,
        name: 'Balanced Medium',
        description: 'Approachable medium with sweetness and body balance.',
        duration: '12:30–13:30',
        dropTemp: '200–205°C',
        charge: 200,
        dropVal: 202,
        durationSec: 810,
        charge_temp: 200,
        devTime: '1:45–2:15',
        devPct: '13–16%',
        usedFor: ['Colombia Huila', 'Guatemala Antigua'],
        locked: false,
        batches: 22,
    },
    {
        id: 3,
        name: 'House Medium',
        description: 'Consistent, crowd-pleasing medium. Low variance across batches.',
        duration: '13:30–14:30',
        dropTemp: '207–212°C',
        charge: 196,
        dropVal: 210,
        durationSec: 870,
        charge_temp: 196,
        devTime: '2:00–2:30',
        devPct: '14–17%',
        usedFor: ['Brazil Cerrado', 'Guatemala Antigua'],
        locked: true,
        batches: 58,
    },
    {
        id: 4,
        name: 'Dark Roast',
        description: 'Second crack. Bold, heavy body with low acidity.',
        duration: '14:30–16:00',
        dropTemp: '217–222°C',
        charge: 193,
        dropVal: 220,
        durationSec: 930,
        charge_temp: 193,
        devTime: '2:30–3:30',
        devPct: '17–22%',
        usedFor: ['Brazil Cerrado'],
        locked: false,
        batches: 8,
    },
];

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
