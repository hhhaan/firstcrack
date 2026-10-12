/**
 * 프론트엔드 Sentry 단일 통합 지점.
 *
 * - 초기화는 이 모듈 import 시점의 side effect다. main.tsx가 App보다 먼저 이 모듈을
 *   import하므로 App 트리 평가 전에 SDK가 준비된다.
 * - PROD는 자동 활성, DEV는 `VITE_SENTRY_SMOKE=true|1`일 때만 활성 (실수로 개발 이벤트가
 *   프로덕션 프로젝트로 나가는 것을 막는다 — 사이드카/Rust와 같은 정책).
 * - window.onerror / unhandledrejection은 SDK 기본 global handler가 이미 잡는다. 수동 등록 금지.
 * - 앱 내 ErrorBoundary는 캡처하지 않는다. React 19 root 핸들러(reactRootOptions)가 유일한 경로다.
 */
import * as Sentry from '@sentry/react';
import { isOpaqueNetworkMessage } from './errorMessage';
import { mapServerBatchGateError } from './features/plan-matrix';
import { httpStatusOf, isClientSqlStateWarning, isDeterministicClientError, isExpectedRefusal } from './httpStatus';

// DSN은 클라이언트 공개값 (Rust/사이드카도 동일하게 하드코딩) — 빌드 시크릿 의존 제거
const SENTRY_DSN = 'https://a7ad70395dfd0d01e1a94e04fdf4e0e1@o4511400846884864.ingest.us.sentry.io/4511400857042944';

const smoke = import.meta.env.VITE_SENTRY_SMOKE;
/** PROD는 자동, DEV는 스모크 opt-in. 커스텀 React 핸들러 설치 여부도 이 값에 따른다. */
export const isSentryEnabled = import.meta.env.PROD || smoke === 'true' || smoke === '1';

const REDACTED = '[redacted]';
const SENSITIVE_KEY = /password|token|secret|authorization|cookie/i;
/** 값 자체가 식별정보인 키 — 로스터 연결 대상과 원본 쿼리 문자열. */
const REDACTED_KEYS = new Set(['host', 'comport', 'serial', 'path', 'query_string']);
// ponytail: 순환 참조 방어를 WeakSet 대신 깊이 제한으로 처리한다. 천장은 5단계 이하만
// 보존된다는 점 — 더 깊은 컨텍스트가 필요해지면 방문 집합으로 교체.
const MAX_DEPTH = 5;

// URL 쿼리는 통째로 지운다. 문자열/JSON 구분자에서 멈춰야 뒤따르는 본문이 함께 잘리지 않는다.
const URL_QUERY = /(https?:\/\/[^\s?]+)\?[^\s"'<>)\]},;]*/gi;
// `key=value` / `"key":"value"` 형태의 비밀·연결정보. Bearer/Basic 접두는 값에 포함해 함께 지운다.
// 키 앞을 고정하지 않아 `access_token=…`처럼 접두사가 붙은 형태도 잡힌다.
const SENSITIVE_ASSIGNMENT =
    /(password|token|secret|authorization|cookie|host|comport|serial|path)(["']?\s*[=:]\s*["']?)(?:(?:bearer|basic|token)\s+)?[^\s"',;)}\]&]+/gi;

const scrubText = (value: string) =>
    value
        .replace(URL_QUERY, `$1?${REDACTED}`)
        .replace(SENSITIVE_ASSIGNMENT, (_match, key: string, separator: string) => `${key}${separator}${REDACTED}`);

export const scrubSensitive = (value: unknown, depth = 0): unknown => {
    if (typeof value === 'string') return scrubText(value);
    if (!value || typeof value !== 'object') return value;
    if (depth >= MAX_DEPTH) return REDACTED;
    if (Array.isArray(value)) return value.map((item) => scrubSensitive(item, depth + 1));

    const scrubbed: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
        scrubbed[key] =
            SENSITIVE_KEY.test(key) || REDACTED_KEYS.has(key.toLowerCase())
                ? REDACTED
                : scrubSensitive(item, depth + 1);
    }
    return scrubbed;
};

/**
 * 클라이언트가 기대한 거절. HTTP 4xx와 같은 자리의 PostgREST 플랜 게이트
 * (`read_only_plan` 등) — supabase-js 오류에는 status가 없어서 httpStatusOf만으로는 안 잡힌다.
 * React Query 재시도와 Sentry 필터가 같은 판정을 쓴다.
 */
export const isClientRefusal = (error: unknown): boolean => {
    if ((error as { name?: unknown } | null | undefined)?.name === 'BatchLimitError') return true;
    if (mapServerBatchGateError(error)) return true;
    // PostgREST often omits `status` and only sets SQLSTATE `code` (measured 42703).
    if (isDeterministicClientError(error)) return true;
    const status = httpStatusOf(error);
    return status !== undefined && status >= 400 && status < 500;
};

/** Query retry: skip deterministic client/PostgREST failures; still retry transport and 5xx. */
export const retryUnlessClientRefusal = (failureCount: number, error: unknown): boolean =>
    !isClientRefusal(error) && failureCount < 2;

const errorText = (error: unknown): string => {
    if (typeof error === 'string') return error;
    if (error instanceof Error) return `${error.name}: ${error.message}`;
    if (error && typeof error === 'object') {
        const o = error as { name?: unknown; message?: unknown; details?: unknown };
        return [o.name, o.message, o.details].filter((v): v is string => typeof v === 'string').join(' ');
    }
    return '';
};

/** Updater/reqwest 전송 실패. UI 스니펫 목록과 별개 — 토스트 문구를 바꾸지 않는다. */
const UPDATER_NETWORK = /error sending request for url/i;
/** 제거된 plugin:dialog|confirm 호출. ACL 수정이 아니라 클라이언트 노이즈다. */
const TAURI_ACL_NOISE = /not allowed by acl/i;

const isExpectedNoise = (error: unknown): boolean => {
    const text = errorText(error);
    if (!text.trim()) return false;
    return isOpaqueNetworkMessage(text) || UPDATER_NETWORK.test(text) || TAURI_ACL_NOISE.test(text);
};

/**
 * 조치 가능한 오류만 이슈로 남긴다. 기본은 capture이고, 사용자가 취소한 요청(AbortError),
 * 클라이언트 4xx(인증/권한/검증 — 서버 로그로 다룬다), 일시적 전송 실패, 예상된 Tauri ACL
 * 거절은 제외한다. 429는 예외: 레이트 리밋은 우리가 손봐야 하는 운영 문제다.
 */
export const isActionableError = (error: unknown): boolean => {
    if ((error as { name?: unknown } | null | undefined)?.name === 'AbortError') return false;
    if (isExpectedRefusal(error)) return httpStatusOf(error) === 429;
    if (isExpectedNoise(error)) return false;
    return true;
};

export { isExpectedRefusal } from './httpStatus';

const isSupabasePlainObject = (error: unknown): error is { code: string; message: string } => {
    if (!error || typeof error !== 'object' || error instanceof Error) return false;
    const o = error as { code?: unknown; message?: unknown; details?: unknown; hint?: unknown };
    return typeof o.code === 'string' && typeof o.message === 'string' && ('details' in o || 'hint' in o);
};

export class SupabaseError extends Error {
    readonly code: string;

    constructor(message: string, code: string) {
        super(message);
        this.name = 'SupabaseError';
        this.code = code;
    }
}

export const normalizeSupabaseError = (error: unknown): unknown => {
    if (!isSupabasePlainObject(error)) return error;
    return new SupabaseError(error.message, error.code);
};

const dbCodeOf = (error: unknown): string | undefined => {
    if (error instanceof SupabaseError) return error.code;
    if (error && typeof error === 'object') {
        const code = (error as { code?: unknown }).code;
        if (typeof code === 'string' && code.length > 0) return code;
    }
    return undefined;
};

export type CaptureActionableOptions = {
    tags?: Record<string, string>;
    level?: Sentry.SeverityLevel;
    fingerprint?: string[];
    extra?: Record<string, unknown>;
};

const isStructuredCaptureOptions = (value: Record<string, unknown>): boolean =>
    'tags' in value || 'level' in value || 'fingerprint' in value;

export const tagsFromQueryMeta = (meta: Record<string, unknown> | undefined): Record<string, string> => {
    const tags: Record<string, string> = {};
    if (typeof meta?.feature === 'string') tags.feature = meta.feature;
    if (typeof meta?.rpc === 'string') tags.rpc = meta.rpc;
    if (typeof meta?.table === 'string') tags.table = meta.table;
    return tags;
};

const supabaseFingerprint = (code: string, tags: Record<string, string>): string[] => [
    'supabase',
    code,
    tags.rpc ?? tags.table ?? tags.feature ?? 'unknown',
];

const beforeSend = (event: Sentry.ErrorEvent, hint: Sentry.EventHint): Sentry.ErrorEvent | null => {
    if (!isActionableError(hint.originalException ?? event.exception?.values?.[0]?.value ?? event.message)) {
        return null;
    }
    if (event.message) event.message = scrubText(event.message);
    for (const exception of event.exception?.values ?? []) {
        if (exception.value) exception.value = scrubText(exception.value);
    }
    if (event.extra) event.extra = scrubSensitive(event.extra) as typeof event.extra;
    if (event.contexts) event.contexts = scrubSensitive(event.contexts) as typeof event.contexts;
    if (event.request) event.request = scrubSensitive(event.request) as typeof event.request;
    if (event.breadcrumbs) event.breadcrumbs = scrubSensitive(event.breadcrumbs) as typeof event.breadcrumbs;
    return event;
};

const beforeBreadcrumb = (breadcrumb: Sentry.Breadcrumb): Sentry.Breadcrumb | null => {
    if (breadcrumb.message) breadcrumb.message = scrubText(breadcrumb.message);
    if (breadcrumb.data) breadcrumb.data = scrubSensitive(breadcrumb.data) as typeof breadcrumb.data;
    return breadcrumb;
};

export const buildSentryOptions = () =>
    ({
        dsn: SENTRY_DSN,
        environment: import.meta.env.PROD ? 'production' : 'development',
        release: `first-crack@${__APP_VERSION__}`,
        integrations: [Sentry.browserTracingIntegration()],
        tracesSampleRate: 0.1,
        initialScope: { tags: { runtime: 'webview' } },
        beforeSend,
        beforeBreadcrumb,
    }) satisfies Sentry.BrowserOptions;

/**
 * ReactDOM.createRoot에 넘길 React 19 오류 핸들러.
 *
 * Sentry가 꺼져 있으면 undefined를 반환한다 — 커스텀 핸들러를 넘기는 순간 React의 기본 콘솔
 * 리포팅이 사라져서, 비활성 개발 환경에서 렌더 오류가 조용히 묻힌다.
 * caught/recoverable은 React가 복구한 오류이므로 콜백을 넘겨 mechanism.handled=true로 보고한다
 * (SDK가 콜백 유무로 handled를 판단한다). uncaught는 콜백 없이 handled=false로 남긴다.
 */
export const reactRootOptions = (onHandled?: (error: unknown) => void) => {
    if (!isSentryEnabled) return undefined;
    const handled = Sentry.reactErrorHandler((error) => onHandled?.(error));
    return {
        onUncaughtError: Sentry.reactErrorHandler(),
        onCaughtError: handled,
        onRecoverableError: handled,
    };
};

/** Sidecar HTTP failures already reported with a fixed message — skip duplicate capture. */
export const isSidecarSentryReported = (error: unknown): boolean =>
    Boolean(error && typeof error === 'object' && (error as { sentryReported?: unknown }).sentryReported === true);

/** 조치 가능한 오류만 Sentry로 보낸다. SDK 미초기화(DEV 기본)면 no-op. */
export const captureActionable = (error: unknown, context?: CaptureActionableOptions | Record<string, unknown>) => {
    if (isSidecarSentryReported(error)) return;
    const normalized = normalizeSupabaseError(error);
    if (!isActionableError(normalized)) return;

    let tags: Record<string, string> = {};
    let level: Sentry.SeverityLevel | undefined;
    let fingerprint: string[] | undefined;
    let extra: Record<string, unknown> | undefined;

    if (context && typeof context === 'object') {
        if (isStructuredCaptureOptions(context as Record<string, unknown>)) {
            const opts = context as CaptureActionableOptions;
            tags = { ...(opts.tags ?? {}) };
            level = opts.level;
            fingerprint = opts.fingerprint;
            extra = opts.extra;
        } else {
            extra = context as Record<string, unknown>;
        }
    }

    const code = dbCodeOf(normalized);
    if (code) tags['db.code'] = code;
    if (!level && isClientSqlStateWarning(normalized)) level = 'warning';
    if (!fingerprint && code) fingerprint = supabaseFingerprint(code, tags);

    const hint: NonNullable<Parameters<typeof Sentry.captureException>[1]> = {};
    if (extra) hint.extra = extra;
    if (Object.keys(tags).length > 0) hint.tags = tags;
    if (level) hint.level = level;
    if (fingerprint) hint.fingerprint = fingerprint;

    // 스크러빙은 beforeSend 한 곳에서만 — 중복 정책 금지.
    Sentry.captureException(normalized, Object.keys(hint).length > 0 ? hint : undefined);
};

export const captureSidecarRequestFailure = (input: {
    route: string;
    method: string;
    status: number | 'network' | 'timeout';
}) => {
    Sentry.captureMessage('sidecar request failed', {
        level: 'error',
        tags: {
            feature: 'sidecar',
            'sidecar.route': input.route,
            'http.status': String(input.status),
            method: input.method,
        },
    });
};

export const captureRoastingImportFailure = (
    error: unknown,
    input: {
        product: string;
        stage: 'graph' | 'machines';
        counts: { selected: number; pending: number; updates: number };
    },
) => {
    captureActionable(error, {
        level: 'error',
        tags: { feature: 'roasting-import', product: input.product, stage: input.stage },
        extra: input.counts,
    });
};

const IMPORT_SCAN_REASONS = new Set([
    'platform',
    'settings-files',
    'settings-unreadable',
    'settings-changed',
    'database-files',
    'database-unreadable',
    'database-changed',
    'database-format',
    'size-limit',
    'record-limit',
    'value-limit',
    'table-compression',
    'record-type',
    'manifest-tag',
]);

const reportedImportScans = new Set<string>();

/** @internal vitest — module-level dedupe must not leak across cases */
export const resetRoastingImportScanDedupeForTests = () => reportedImportScans.clear();

const safeSourceVersion = (version: string | null | undefined): string => {
    if (!version || !/^[\w.-]{1,32}$/.test(version)) return 'other';
    return version;
};

/** Once per app session per product+reason for unreadable/unsupported import scans. */
export const observeRoastingImportScan = (snapshot: {
    status: string;
    reason?: string;
    source: { product: string; version?: string | null };
}) => {
    if (snapshot.status !== 'unreadable' && snapshot.status !== 'unsupported') return;
    const reasonRaw = snapshot.reason ?? '';
    const dedupeKey = `${snapshot.source.product}:${snapshot.status}:${reasonRaw}`;
    if (reportedImportScans.has(dedupeKey)) return;
    reportedImportScans.add(dedupeKey);

    const reason = IMPORT_SCAN_REASONS.has(reasonRaw) ? reasonRaw : 'other';
    const level = snapshot.status === 'unreadable' ? 'warning' : 'info';
    Sentry.captureMessage('roasting import scan', {
        level,
        tags: {
            feature: 'roasting-import',
            product: snapshot.source.product,
            status: snapshot.status,
            reason,
            'source.version': safeSourceVersion(snapshot.source.version ?? null),
        },
    });
};

export const reportTsvRestoreDroppedRows = (droppedRows: number) => {
    if (droppedRows <= 0) return;
    Sentry.addBreadcrumb({
        category: 'tsv-restore',
        message: 'extra readings dropped',
        data: { dropped_rows: droppedRows },
    });
    Sentry.captureMessage('tsv restore dropped extra readings', {
        level: 'warning',
        tags: { feature: 'tsv-restore' },
        extra: { dropped_rows: droppedRows },
    });
};

/** 사용자 식별은 id만. workspace는 태그(검색)와 컨텍스트(가독성) 양쪽에 남긴다. */
export const setSentryIdentity = (userId?: string | null, workspaceId?: string | null) => {
    Sentry.setUser(userId ? { id: userId } : null);
    Sentry.setTag('workspace.id', workspaceId ?? undefined);
    Sentry.setContext('workspace', workspaceId ? { id: workspaceId } : null);
};

// 테스트에서는 개발자 로컬 env(.env의 스모크 플래그 등)로 실 SDK가 켜지지 않게 막는다.
if (isSentryEnabled && import.meta.env.MODE !== 'test') Sentry.init(buildSentryOptions());
