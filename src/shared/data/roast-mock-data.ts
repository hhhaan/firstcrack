import type { RoastPoint } from '../types/roast';

const generateFullRoastData = (): RoastPoint[] => {
    const points: RoastPoint[] = [];
    for (let t = 0; t <= 780; t += 15) {
        const min = t / 60;
        let bt: number;

        if (t <= 90) {
            bt = 200 - (48 * t) / 90;
        } else if (t <= 180) {
            bt = 152 + (4 * (t - 90)) / 90;
        } else if (t <= 420) {
            bt = 156 + (18 * (t - 180)) / 240;
        } else if (t <= 660) {
            bt = 174 + (19 * (t - 420)) / 240;
        } else {
            bt = 193 + (10 * (t - 660)) / 120;
        }

        const et = t === 0 ? 220 : t <= 90 ? 220 - (5 * t) / 90 : 215 + Math.sin(t / 300) * 0.8;

        let ror = 0;
        if (points.length > 0) {
            const prev = points[points.length - 1];
            ror = (bt - prev.bt) / (15 / 60);
            if (t <= 90) ror = 0;
        }

        points.push({
            time: t,
            label: `${Math.floor(min)}:${String(Math.round((min % 1) * 60)).padStart(2, '0')}`,
            bt: Math.round(bt * 10) / 10,
            et: Math.round(et * 10) / 10,
            ror: Math.max(0, Math.round(ror * 10) / 10),
        });
    }
    return points;
};

export const fullData: RoastPoint[] = generateFullRoastData();
