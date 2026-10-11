import type { BbpPoint } from '@features/active-roast/model/bbp';
import { formatLookbackLabel, type LiveRoastPoint } from '../model/useSidecarPolling';

/** BBP samples use elapsed seconds since End, starting at the left of the chart. */
export const livePointsFromBbp = (points: BbpPoint[]): LiveRoastPoint[] =>
    points.map((p) => ({
        time: p.t,
        label: formatLookbackLabel(p.t),
        bt: p.bt,
        et: p.et,
        ror: null,
        ror_et: null,
        heater: p.heater,
        fan: p.fan,
        drum: p.drum,
        extraReadings: p.extraReadings,
        etRaw: p.etRaw,
        btRaw: p.btRaw,
        sensorTimestamp: p.sensorTimestamp,
        sensorClock: p.sensorClock,
        processing: p.processing,
    }));
