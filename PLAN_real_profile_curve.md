# 프로파일 페이지 실제 커브 표시 구현 계획

## 목표

Profiles 페이지의 메인 차트(상세 패널 + 비교 모드)를 **합성 곡선(`generateProfileCurve`)에서 R2 TSV 실측 데이터로** 교체한다.
좌측 sparkline과 수동 생성 프로파일은 기존 합성 곡선을 유지하고 안내만 추가한다.

---

## 현재 상태

- **메타데이터**: `roast_profiles`(Supabase) — name, drop_temp, duration, dev_time 등. 커브 포인트는 **없음**.
- **실측 커브**: `roast_sessions.tsv_path` → R2 `profiles/{userId}/{sessionId}.tsv` (`time\tbt\tet\tror\theater\tfan\tdrum`).
- **연결**: `roast_profiles.source_session_id` → `roast_sessions.id` (FK, nullable).
- **업로드 경로**: `ActiveRoast.tsx:967` — `S3Client` + `VITE_R2_*` 자격증명을 client 번들에서 직접 사용.
- **현재 렌더**: `Profiles.tsx:233-234` — `generateProfileCurve(drop_temp ?? 200, duration ?? 720)` 호출하여 합성 곡선만 그림.

---

## 결정사항 (확정)

| # | 항목 | 결정 |
|---|------|------|
| 1 | Sparkline | **합성 곡선 유지** — 리스트 진입 시 N개 R2 fetch 회피 |
| 2 | Manual 프로파일 (source_session_id = null) | **합성 곡선 + "기록된 데이터 없음" 뱃지** |
| 3 | R2 read 자격증명 | **client SDK 그대로 사용** — Cloudflare Worker 도입은 별도 PR(TODO 메모) |

---

## 변경 파일 목록

| 파일 | 규모 | 성격 |
|------|------|------|
| `src/shared/lib/r2.ts` | +30줄 (신규) | S3Client 싱글톤 + `fetchTsv(key)` |
| `src/shared/lib/tsv.ts` | +25줄 (신규) | TSV → `{t, bt}[]` 파서 |
| `src/entities/roast-profile/api.ts` | ~5줄 수정 | `list`에 `source_session:roast_sessions!source_session_id(tsv_path)` join |
| `src/shared/types/database.types.ts` | 자동 갱신 | `types:gen` 실행 — 단 join 결과 타입은 entity에서 alias로 추가 |
| `src/entities/roast-profile/index.ts` | +1줄 | `useRoastProfileCurve` export |
| `src/entities/roast-profile/queries.ts` | +20줄 | `useRoastProfileCurve(profile)` 추가 |
| `src/views/profiles/Profiles.tsx` | ~30줄 수정 | `curveFor` 교체, 안내 뱃지, 비교 모드 |
| **TODO 메모** | — | R2 자격증명 → Cloudflare Worker 마이그레이션 (memory에 추가) |

---

## Task 1 — R2 read 유틸 (`shared/lib/r2.ts`)

S3Client를 **싱글톤**으로 만들어 fetch마다 새로 생성하지 않도록 한다. (현재 업로드 코드는 호출마다 생성 — 이 패턴은 복사하지 말 것.)

```ts
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';

let client: S3Client | null = null;

const getClient = (): S3Client => {
    if (client) return client;
    client = new S3Client({
        region: 'auto',
        endpoint: `https://${import.meta.env.VITE_R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
        credentials: {
            accessKeyId: import.meta.env.VITE_R2_ACCESS_KEY_ID,
            secretAccessKey: import.meta.env.VITE_R2_SECRET_ACCESS_KEY,
        },
    });
    return client;
};

export const fetchTsvFromR2 = async (key: string): Promise<string> => {
    const res = await getClient().send(
        new GetObjectCommand({
            Bucket: import.meta.env.VITE_R2_BUCKET_NAME,
            Key: key,
        }),
    );
    if (!res.Body) throw new Error(`Empty body for ${key}`);
    return await res.Body.transformToString();
};
```

> **보안 TODO**: 이 모듈은 `VITE_R2_*` 자격증명을 client 번들에 그대로 노출한다. Tauri 배포 시 binary에서 추출 가능 → 모든 사용자 R2 read/write/delete 권한 노출. 후속 PR에서 Cloudflare Worker + 서명 URL로 이전 예정. (`memory: project_r2_credential_exposure_todo.md` 등록)

## Task 2 — TSV 파서 (`shared/lib/tsv.ts`)

```ts
export interface TsvPoint {
    t: number;       // 초 (post-charge 상대 시간, useSidecarPolling.ts:153 기준)
    bt: number;
    et: number | null;
    ror: number | null;
}

export const parseTsv = (text: string): TsvPoint[] => {
    const lines = text.split('\n').filter((l) => l.trim());
    if (lines.length <= 1) return [];
    // header: time\tbt\tet\tror\theater\tfan\tdrum
    const points: TsvPoint[] = [];
    for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split('\t');
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
```

> **시간 의미 확인**: `useSidecarPolling.ts:153`에서 `t = (Date.now() - roastStartTimeRef.current) / 1000`. 즉 TSV는 **charge 시점 0초 기준 post-charge 상대 시간만** 기록. pre-charge 데이터는 TSV에 없음 — 합성 곡선(t=0부터 시작)과 시각적으로 일관.

## Task 3 — `roast_profiles` 조회에 source session join 추가

`entities/roast-profile/api.ts`:

```ts
const SELECT_WITH_SESSION = '*, source_session:roast_sessions!source_session_id(tsv_path)';

export type RoastProfileWithSource = RoastProfile & {
    source_session: { tsv_path: string | null } | null;
};

// list:
const { data, error } = await supabase
    .from('roast_profiles')
    .select(SELECT_WITH_SESSION)
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
// return type: RoastProfileWithSource[]
```

타입 alias는 entity 내부에서 정의 (database.types.ts는 자동 생성 영역 건드리지 않음).
`Profiles.tsx`의 `profiles` 타입과 `RoastProfile` import도 함께 수정.

## Task 4 — `useRoastProfileCurve` 쿼리 훅

`entities/roast-profile/queries.ts`:

```ts
import { fetchTsvFromR2 } from '@shared/lib/r2';
import { parseTsv, type TsvPoint } from '@shared/lib/tsv';

export const useRoastProfileCurve = (tsvPath: string | null | undefined) =>
    useQuery({
        queryKey: ['roast_profile_curve', tsvPath],
        queryFn: async (): Promise<TsvPoint[]> => {
            if (!tsvPath) return [];
            const text = await fetchTsvFromR2(tsvPath);
            return parseTsv(text);
        },
        enabled: !!tsvPath,
        staleTime: Infinity,  // TSV는 immutable
        gcTime: Infinity,
    });
```

캐싱 정책:
- **`staleTime: Infinity`, `gcTime: Infinity`**: TSV는 한 번 업로드되면 변경되지 않음(session immutable). 세션당 1회 fetch.
- queryKey는 `tsvPath` 자체 — 프로파일 ID 변경되어도 같은 세션을 가리키면 캐시 재사용.

## Task 5 — Profiles 뷰 수정

### 5-1. 단일 상세 차트

`Profiles.tsx`의 `selected` 분기에서 `useRoastProfileCurve(selected.source_session?.tsv_path)` 호출.

```ts
const { data: realCurve = [], isLoading: curveLoading } =
    useRoastProfileCurve(selected?.source_session?.tsv_path);

const hasRealCurve = realCurve.length > 0;

const seriesForSelected = hasRealCurve
    ? [{ curve: realCurve.map((p) => ({ t: p.t, bt: p.bt })),
         color: 'var(--color-primary)',
         label: selected.name }]
    : [{ curve: generateProfileCurve(selected.drop_temp_celsius ?? 200, selected.duration_sec ?? 720),
         color: 'var(--color-primary)',
         label: selected.name }];
```

### 5-2. 안내 뱃지 (Manual 프로파일 / 미기록)

```tsx
{selected.source_session?.tsv_path && hasRealCurve ? (
    <span className="text-[10px] text-muted">실측 곡선</span>
) : (
    <span className="text-[10px] text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">
        기록된 데이터 없음 (참고용 곡선)
    </span>
)}
```

배치 위치: `Profile Curve` 헤더 옆 (line 512 부근).

### 5-3. 비교 모드

`compareIds` 각각에 대해 `useRoastProfileCurve` 호출이 필요 — 훅을 4번 호출하면 hooks 규칙 위반.
**해결**: 별도 컴포넌트 `<CompareCurveSeries>`로 분리하여 각 프로파일마다 인스턴스 생성, 또는 한 번에 여러 path를 다루는 `useQueries` 사용.

권장 — `useQueries`:

```ts
import { useQueries } from '@tanstack/react-query';

const curveQueries = useQueries({
    queries: compareProfiles.map((p) => ({
        queryKey: ['roast_profile_curve', p.source_session?.tsv_path],
        queryFn: async () => {
            if (!p.source_session?.tsv_path) return [];
            return parseTsv(await fetchTsvFromR2(p.source_session.tsv_path));
        },
        enabled: !!p.source_session?.tsv_path,
        staleTime: Infinity,
        gcTime: Infinity,
    })),
});

const chartSeries: SeriesData[] = compareProfiles.map((p, i) => {
    const real = curveQueries[i].data ?? [];
    const curve = real.length > 0
        ? real.map((pt) => ({ t: pt.t, bt: pt.bt }))
        : generateProfileCurve(p.drop_temp_celsius ?? 200, p.duration_sec ?? 720);
    return { curve, color: COMPARE_COLORS[i], label: p.name };
});
```

### 5-4. Sparkline (변경 없음)

`curveFor(profile)` 호출 그대로 유지 — 합성 곡선. ✅ 결정 #1.

### 5-5. 로딩 UX

상세 패널 차트만 `curveLoading` 시 차트 영역에 스켈레톤(또는 옅은 합성 곡선 + spinner). 비교 모드는 각 시리즈가 따로 로드되므로 isLoading state 표시 생략, 그냥 점진적으로 나타나게.

---

## Task 6 — uPlot 차트 어댑터

현재 `ProfileCurveChart`는 `curve: { t: number; bt: number }[]` 받음 → **그대로 호환**.

x축 grid 간격: 합성은 30s 간격, 실측은 ~0.5s 간격(2 Hz). uPlot의 `incrs: [30, 60, 120, 180, 300]`이 이미 적절. **downsampling 불필요** — 4개 프로파일 × ~600 포인트 = 2400 포인트, uPlot 충분히 처리.

단, `ProfileCurveChart`의 `useEffect` deps에 `[]`로 되어 있고 `chartKey`로 remount하는 패턴 유지 — 시리즈가 비동기로 들어올 때마다 remount하도록 key 조정 필요:

```ts
const chartKey = compareMode
    ? `${compareIds.join(',')}|${curveQueries.map((q) => q.data?.length ?? 0).join(',')}`
    : `${selectedId}|${realCurve.length}`;
```

(데이터 길이를 key에 포함하면 fetch 완료 시 remount 됨)

---

## Task 7 — TODO 메모리 등록

세션 종료 후 `MEMORY.md` + 신규 메모 파일 추가:

- `project_r2_credential_exposure_todo.md`
  - 현재 R2 자격증명이 client 번들에 노출 (`VITE_R2_*`)
  - 영향: 모든 사용자의 R2 read/write/delete 권한이 binary 추출 시 노출
  - 다음 단계: Cloudflare Worker + Supabase JWT 검증 + presigned URL
  - 영향 코드: `shared/lib/r2.ts`, `views/active-roast/ActiveRoast.tsx:967`

---

## 검증 단계

1. **타입 체크**: `npm run typecheck` (또는 `tsc --noEmit`)
2. **수동 시나리오**:
   - `source_session_id`가 있는 프로파일 선택 → 실측 곡선 표시 확인 (sparkline은 합성 유지)
   - manual 프로파일 선택 → 합성 곡선 + 안내 뱃지 표시 확인
   - 비교 모드로 실측 + 수동 mix → 각각 올바른 curve 사용 확인
   - source_session은 있지만 tsv_path가 null인 경우 (TAURI 외 환경에서 저장) → 합성 fallback
   - 같은 프로파일 재선택 → 네트워크 탭에서 R2 호출 없음 (캐시 확인)
3. **Tauri 환경에서 확인**: `npm run tauri dev` 후 testuser1@gmail.com / 1234 로그인 (memory: user_test_credentials)

---

## 영향받지 않는 부분

- `roast_profiles` 스키마 변경 없음 → `types:gen` / 마이그레이션 불필요
- `useSidecarPolling.ts` TSV 기록 로직 변경 없음
- `ActiveRoast.tsx` 업로드 경로 변경 없음
- `NewProfileModal.tsx` 변경 없음 (이미 source_session_id 저장 중)

---

## 단계별 커밋 제안

1. `feat: R2 read 유틸 + TSV 파서 추가 (shared/lib)`
2. `feat: roast_profiles 조회에 source_session join 추가`
3. `feat: useRoastProfileCurve 훅 추가`
4. `feat: 프로파일 상세 차트를 실측 TSV 곡선으로 교체`
5. `feat: 비교 모드에 실측 곡선 적용 (useQueries)`
6. `docs: R2 자격증명 노출 TODO 메모리 등록`
