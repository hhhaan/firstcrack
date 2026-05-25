# Pre-charge 그래프 시각화 구현 계획

## 목표

- Preheating/Standby 단계부터 BT/ET를 차트에 실시간으로 표시
- Charge 감지 시 직전 N초(기본 60초, 사용자 설정 가능)만 남기고 나머지 pre-charge 데이터 제거
- x축을 Charge 기준 상대 시간으로 표시 (음수 = Charge 이전)

---

## 변경 파일 목록

| 파일 | 규모 | 성격 |
|------|------|------|
| `features/active-roast/model/settings.ts` | +5줄 | 설정값 추가 |
| `views/active-roast/hooks/useSidecarPolling.ts` | +45줄 | 핵심 로직 |
| `views/active-roast/hooks/useChartData.ts` | ~10줄 수정 | x축 범위 확장 |
| `views/active-roast/hooks/useChartZoom.ts` | ~10줄 수정 | zoom 하한선 파라미터화 |
| `widgets/active-roast/ui/RoastTempChart.tsx` | ~20줄 수정 | 음수 포맷 + CHARGE 마커 |
| `views/active-roast/ActiveRoast.tsx` | ~15줄 수정 | deltaBT 필터, zoom 연결 |

---

## Task 1 — Settings 확장

**파일**: `src/features/active-roast/model/settings.ts`

```ts
export type RoastSettings = {
  // ... 기존 필드
  preChargeDisplaySec: number;  // 추가: Charge 이전 표시 구간 (초)
};

const DEFAULT_SETTINGS: RoastSettings = {
  // ... 기존 값
  preChargeDisplaySec: 60,      // 추가
};
```

RoastSettings UI 패널에 슬라이더 추가 (선택지: 30 / 60 / 90 / 120초).

---

## Task 2 — Pre-charge Buffer (`useSidecarPolling.ts`)

### 설계 원칙

- preheating/standby 단계에서 절대 timestamp(`absTime`)로 버퍼에 누적
- `phase → 'roasting'` 전환 시 버퍼에서 최근 N초만 꺼내 음수 상대 시간으로 변환 후 livePoints 앞에 삽입
- `roastStartTimeRef.current`는 이미 전달되고 있으므로 추가 prop 없음

### 코드 변경

```ts
// useSidecarPolling.ts — 인터페이스 변경 없음, 내부 로직만 추가

export const useSidecarPolling = ({ ..., roastStartTimeRef, preChargeDisplaySec }: Params) => {
    const [livePoints, setLivePoints] = useState<LiveRoastPoint[]>([]);
    const tsvInitializedRef = useRef(false);

    // ★ 추가: pre-charge 버퍼 (절대 시각 기록)
    const preChargeBufferRef = useRef<(LiveRoastPoint & { absTime: number })[]>([]);
    const prevPhaseRef = useRef<string>(phase);

    // ★ 추가: phase → 'roasting' 전환 감지 → 버퍼 flush
    useEffect(() => {
        if (prevPhaseRef.current !== 'roasting' && phase === 'roasting') {
            const chargeTime = roastStartTimeRef.current;
            if (chargeTime === 0) return;

            const cutoff = chargeTime - preChargeDisplaySec * 1000;
            const prePoints = preChargeBufferRef.current
                .filter((p) => p.absTime >= cutoff)
                .map((p) => ({
                    ...p,
                    time: (p.absTime - chargeTime) / 1000,   // 음수 상대 시간
                    label: (() => {
                        const t = Math.abs((p.absTime - chargeTime) / 1000);
                        return `-${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
                    })(),
                }));

            setLivePoints((prev) => [...prePoints, ...prev]);
            preChargeBufferRef.current = [];
        }
        prevPhaseRef.current = phase;
    }, [phase, roastStartTimeRef, preChargeDisplaySec]);

    // ★ 수정: preheating/standby 단계에서도 폴링 실행 (기존: idle/ended만 제외)
    useEffect(() => {
        if (phase === 'idle' || phase === 'ended') return;

        const poll = async () => {
            try {
                const data = await sidecar.getTemperatures();
                // ... 기존 연결 체크 로직 유지

                useRoastingStore.getState().updateLiveData(data);
                setConnected(true);
                const bt = data.bt;
                if (bt == null) return;

                const currentPhase = useRoastingStore.getState().phase;

                if (currentPhase === 'roasting' && roastStartTimeRef.current !== 0) {
                    // 기존: post-charge 포인트 기록 (변경 없음)
                    const t = (Date.now() - roastStartTimeRef.current) / 1000;
                    setLivePoints((prev) => {
                        if (prev.length > 0 && t - prev[prev.length - 1].time < 0.4) return prev;
                        // ... 기존 포인트 생성 로직
                        return [...prev, point];
                    });
                } else if (currentPhase === 'preheating' || currentPhase === 'standby') {
                    // ★ 추가: pre-charge 버퍼에 누적
                    const absTime = Date.now();
                    const buf = preChargeBufferRef.current;
                    if (buf.length > 0 && absTime - buf[buf.length - 1].absTime < 400) return;
                    buf.push({
                        absTime,
                        time: 0,        // flush 시 재계산됨
                        label: '',
                        bt,
                        et: data.et ?? null,
                        ror: data.ror,
                        ror_et: data.ror_et ?? null,
                        heater: data.heater ?? 0,
                        fan: data.fan ?? 0,
                        drum: data.drum ?? 0,
                    });
                    // 메모리 cap: 최대 20분치 (1200포인트 @ 1s 간격)
                    if (buf.length > 1200) buf.splice(0, buf.length - 1200);
                }
            } catch {
                setConnected(false);
            }
        };

        poll();
        const id = setInterval(poll, pollIntervalMs);
        return () => clearInterval(id);
    }, [phase, pollIntervalMs]);

    return { livePoints, setLivePoints };
};
```

**Params 인터페이스에 추가**:
```ts
interface Params {
  // ... 기존
  preChargeDisplaySec: number;  // 추가
}
```

---

## Task 3 — Chart x-axis 확장 (`useChartData.ts`)

```ts
// 파라미터 추가
export const useChartData = ({
    livePoints,
    targetProfile,
    preChargeDisplaySec,    // ★ 추가
}: {
    livePoints: LiveRoastPoint[];
    targetProfile: RoastProfile | null;
    preChargeDisplaySec: number;    // ★ 추가
}) => {
    // ...

    const chartData = useMemo(() => {
        const sentinel = (t: number) => ({ ... });

        // ...deduped 생성 로직 동일

        // ★ 변경: 시작 sentinel을 -preChargeDisplaySec 기준으로
        const X_MIN = -preChargeDisplaySec;
        const needsStart = deduped.length === 0 || deduped[0].time > X_MIN + 0.5;
        const needsEnd = deduped.length === 0 || deduped[deduped.length - 1].time < CHART_TOTAL_SECS - 1;

        return [
            ...(needsStart ? [sentinel(X_MIN)] : []),   // ★ 0 → X_MIN
            ...deduped,
            ...(needsEnd ? [sentinel(CHART_TOTAL_SECS)] : []),
        ];
    }, [livePoints, targetCurve, targetSamples, preChargeDisplaySec]);
```

---

## Task 4 — 차트 렌더링 수정 (`RoastTempChart.tsx`)

### 4-A. 음수 시간 포맷

```ts
// 현재
const fmtSec = (v: number) => {
    const m = Math.floor(v / 60);
    const s = Math.round(v % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
};

// 변경
const fmtSec = (v: number) => {
    const sign = v < 0 ? '-' : '';
    const abs = Math.abs(v);
    const m = Math.floor(abs / 60);
    const s = Math.round(abs % 60);
    return `${sign}${m}:${String(s).padStart(2, '0')}`;
};
```

### 4-B. CHARGE 수직선 마커 (x=0)

BT Actual series의 `markLine.data`에 추가:

```ts
const chargeMarkLine = {
    xAxis: 0,
    lineStyle: { color: '#6366f1', width: 1.5, type: 'dashed' as const },
    label: {
        show: true,
        position: 'insideStartTop',
        formatter: 'CHARGE',
        color: '#6366f1',
        fontSize: 10,
        fontWeight: 700,
    },
};

// BT Actual series의 markLine:
markLine: {
    silent: true,
    symbol: 'none',
    data: [chargeMarkLine, ...eventMarkLines, ...tpMarkLines],   // ★ chargeMarkLine 추가
},
```

---

## Task 5 — Zoom 하한선 수정 (`useChartZoom.ts`)

`useChartZoom`이 `minTime: number` 파라미터를 받도록 변경:

```ts
export const useChartZoom = (MAX_TIME: number, minTime: number = 0): ChartZoom => {

    // effectiveZoomRange 클램핑 변경
    const effectiveZoomRange = zoomRange
        ? { start: Math.max(minTime, zoomRange.start), end: Math.min(MAX_TIME, zoomRange.end) }
        : null;

    // handleChartWheel — nextStart 하한선
    if (nextStart < minTime) {
        nextStart = minTime;
        nextEnd = minTime + nextDuration;
    }

    // handleChartPointerMove — 드래그 하한선
    const nextStart = Math.max(minTime, Math.min(MAX_TIME - duration, drag.startRange.start + deltaTime));
```

---

## Task 6 — ActiveRoast.tsx 수정

### 6-A. useChartZoom에 minTime 전달

```ts
const preChargeDisplaySec = roastSettings.preChargeDisplaySec;
const MIN_TIME = charged ? -preChargeDisplaySec : 0;
// (charge 전에는 preheating 전체 데이터가 보이게 minTime=0 유지,
//  charge 후에는 -preChargeDisplaySec 이전을 pan 불가로)

const { ... } = useChartZoom(MAX_TIME, MIN_TIME);
```

### 6-B. zoomChart/panChart 하한선 수정

```ts
const zoomChart = (zoomFactor: number) => {
    // ...
    const minStart = -preChargeDisplaySec;   // ★ 0 → minStart

    if (nextStart < minStart) {
        nextStart = minStart;
        nextEnd = minStart + nextDuration;
    }
    // ...
};

const panChart = (direction: -1 | 1) => {
    if (!effectiveZoomRange) return;
    const duration = effectiveZoomRange.end - effectiveZoomRange.start;
    const step = Math.max(1, duration * 0.2);
    const minStart = -preChargeDisplaySec;   // ★ 추가
    const nextStart = Math.max(minStart, Math.min(MAX_TIME - duration, effectiveZoomRange.start + step * direction));
    setZoomRange({ start: nextStart, end: nextStart + duration });
};
```

### 6-C. deltaBT 계산 — post-charge 포인트만 사용

```ts
const { deltaBT, deltaET } = useMemo(() => {
    // ★ pre-charge 포인트 제외 (time < 0인 포인트는 charge 이전)
    const postChargePoints = livePoints.filter((p) => p.time >= 0);
    if (postChargePoints.length < 2) return { deltaBT: null, deltaET: null };

    const current = postChargePoints[postChargePoints.length - 1];
    const targetTime = current.time - 30;
    const past = postChargePoints.reduce((prev, curr) =>
        Math.abs(curr.time - targetTime) < Math.abs(prev.time - targetTime) ? curr : prev,
    );
    // ... 나머지 동일
}, [livePoints, unit]);
```

### 6-D. useSidecarPolling 호출에 preChargeDisplaySec 전달

```ts
const { livePoints, setLivePoints } = useSidecarPolling({
    // ... 기존
    preChargeDisplaySec: roastSettings.preChargeDisplaySec,   // ★ 추가
});
```

### 6-E. useChartData 호출에 preChargeDisplaySec 전달

```ts
const { chartData } = useChartData({
    livePoints,
    targetProfile,
    preChargeDisplaySec: roastSettings.preChargeDisplaySec,   // ★ 추가
});
```

---

## 워크플로우 주의사항

### useAutoDetection 영향 확인 필요

`useAutoDetection`이 `livePoints` 전체를 받아 TP/AutoCharge를 감지함.
Pre-charge 포인트(time < 0)가 prepend되면 TP 감지 로직에 영향이 있는지 확인.
`useAutoDetection` 내부에서 `time >= 0` 필터가 필요할 수 있음.

### Control 차트 (Drum/Heat/Fan)

Pre-charge 중 drum/heater/fan 값도 함께 표시됨 — 의도된 동작.
드럼 온도 안정화 곡선이 pre-charge 구간에서도 유용한 맥락 정보를 제공.

### TSV 파일 기록

현재 TSV는 post-charge 데이터만 기록함 (sessionId 있을 때만).
Pre-charge 데이터는 TSV에 포함하지 않음 — 변경 없이 현행 유지.

---

## 구현 순서

```
Task 1 (settings) → Task 2 (polling) → Task 3 (chartData) → Task 6 (ActiveRoast) → Task 4 (chart render) → Task 5 (zoom)
```

앞 태스크가 뒤 태스크의 파라미터를 결정하므로 순서대로 진행.
