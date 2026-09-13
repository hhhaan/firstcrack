import type { BbpPoint } from '@features/active-roast/model/bbp';
import { formatElapsed } from '@shared/lib/format';
import type { LiveRoastPoint } from '../model/useSidecarPolling';

/** BBP 스토어 포인트를 라이브 차트 시계열로. t는 End 확정 기준 초. */
export const livePointsFromBbp = (points: BbpPoint[]): LiveRoastPoint[] =>
    points.map((p) => ({
        time: p.t,
        label: formatElapsed(p.t),
        bt: p.bt,
        et: p.et,
        ror: null,
        ror_et: null,
        heater: p.heater,
        fan: p.fan,
        drum: p.drum,
    }));
