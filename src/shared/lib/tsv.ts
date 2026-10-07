import type { TemperatureProcessing } from '@shared/types/sidecar';
import { z } from 'zod';

const processingSchema: z.ZodType<TemperatureProcessing> = z.object({
    algorithm_version: z.string().min(1),
    temperature_unit: z.literal('C'),
    ror_unit: z.literal('C/min'),
    timestamp_clock: z.literal('sidecar-monotonic-seconds'),
    display_ema_alpha: z.number().positive().max(1),
    et_display_ema_alpha: z.number().positive().max(1).optional(),
    ror_ema_alpha: z.number().positive().max(1),
    et_ror_ema_alpha: z.number().positive().max(1).optional(),
    ror_window_sec: z.number().finite().positive(),
    ror_warmup_reads: z.number().int().nonnegative(),
});

export interface TsvPoint {
    t: number;
    bt: number;
    et: number | null;
    ror: number | null;
    heater: number | null;
    fan: number | null;
    drum: number | null;
    /** 사이드카가 쓴 heater 세트포인트(8열). 열이 생기기 전 기록에는 없다 */
    heaterSet?: number | null;
    /** 평활화 전 ET(9열). 차트·감지는 `et`를 쓴다. 열이 생기기 전 기록에는 없다 */
    etRaw?: number | null;
    /** 평활화 전 BT(10열). 차트는 `bt`를 쓴다. 구 기록에는 없다 */
    btRaw?: number | null;
    /** 사이드카가 계산한 ET RoR(11열). 구 기록에는 없다 */
    rorEt?: number | null;
    /** Sidecar monotonic sample time (seconds), unrelated to Charge-relative t. */
    sensorTimestamp?: number | null;
    /** Clock/connection segment; timestamps must not be compared across segments. */
    sensorClock?: string | null;
    processing?: TemperatureProcessing;
}

const optionalCol = (raw: string | undefined): number | null => {
    if (!raw) return null;
    const n = parseFloat(raw);
    return Number.isFinite(n) ? n : null;
};

// TSV 형식 (useSidecarPolling.ts:21):
// time\tbt\tet\tror\theater\tfan\tdrum\theater_set\tet_raw\tbt_raw\tror_et\tsensor_timestamp\tsensor_clock
// 8~13열은 선택. '# processing\tJSON' 행은 이후 표본의 계산 설정이다.
// t는 charge 시점(=0) 기준 post-charge 상대 시간(초).
export const parseTsv = (text: string): TsvPoint[] => {
    const lines = text.split('\n');
    const points: TsvPoint[] = [];
    let processing: TemperatureProcessing | undefined;
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].replace(/\r$/, '');
        if (!line) continue;
        if (line.startsWith('# processing\t')) {
            processing = undefined;
            try {
                const parsed = processingSchema.safeParse(JSON.parse(line.slice('# processing\t'.length)));
                if (parsed.success) processing = parsed.data;
            } catch {
                /* Malformed metadata must not discard valid temperature samples. */
            }
            continue;
        }
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
            heaterSet: optionalCol(cols[7]),
            etRaw: optionalCol(cols[8]),
            btRaw: optionalCol(cols[9]),
            rorEt: optionalCol(cols[10]),
            sensorTimestamp: optionalCol(cols[11]),
            sensorClock: /^[a-f0-9]{32}:\d+$/.test(cols[12] ?? '') ? cols[12] : null,
            ...(processing ? { processing } : {}),
        });
    }
    return points;
};
