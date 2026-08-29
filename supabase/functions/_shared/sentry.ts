/**
 * Sentry capture for Supabase Edge (Deno).
 *
 * Deliberately a hand-rolled Store API POST instead of `@sentry/deno`: this
 * module is unit-tested by Vitest (`vite.config.ts` includes
 * `supabase/functions/_shared/**\/*.test.ts`), which cannot resolve Deno-only
 * specifiers without a mock layer bigger than the transport itself.
 *
 * Set the `SENTRY_DSN` secret to enable; every export is a no-op without it.
 */

export type CaptureOpts = {
    /** Edge function name → `function` tag. */
    function?: string;
    /** HTTP status about to be returned. 4xx is caller fault and is dropped. */
    status?: number;
    tags?: Record<string, string>;
    extra?: Record<string, unknown>;
    level?: 'error' | 'warning' | 'info';
};

const REDACTED = '[redacted]';
const MAX_SCRUB_DEPTH = 6;

/** Key names whose value is a credential, never a diagnostic. */
const SECRET_KEY_RE =
    /(token|secret|authorization|cookie|password|passwd|credential|signature|hmac|dsn|api[-_]?key|access[-_]?key|private[-_]?key)/i;

/** Presigned R2/S3 URLs carry the signature in the query string. */
function scrubUrls(text: string): string {
    return text.replace(/(https?:\/\/[^\s"'`]+?)\?[^\s"'`]*/g, `$1?${REDACTED}`);
}

/** Recursively redact credential-shaped keys and presigned query strings. */
export function scrubSensitive(value: unknown, depth = 0): unknown {
    if (typeof value === 'string') return scrubUrls(value);
    if (value === null || typeof value !== 'object') return value;
    if (depth >= MAX_SCRUB_DEPTH) return '[truncated]';
    if (Array.isArray(value)) return value.map((item) => scrubSensitive(item, depth + 1));

    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
        out[key] = SECRET_KEY_RE.test(key) ? REDACTED : scrubSensitive(val, depth + 1);
    }
    return out;
}

/**
 * Whether a failure is ours to fix. Rejected auth, bad signatures and invalid
 * input are the caller's problem and would drown the real 5xx signal.
 * An undefined status means "thrown before a response was chosen" → report.
 */
export function isActionableEdgeError(status?: number): boolean {
    return status === undefined || status >= 500;
}

/** Supabase hands back plain `{ message, code }` objects, not `Error`s. */
function describe(err: unknown): { type: string; message: string } {
    if (err instanceof Error) return { type: err.name, message: err.message };
    const bag = (typeof err === 'object' && err !== null ? err : {}) as { name?: unknown; message?: unknown };
    return {
        type: typeof bag.name === 'string' ? bag.name : 'Error',
        message: typeof bag.message === 'string' ? bag.message : String(err),
    };
}

function parseDsn(dsn: string): { publicKey: string; host: string; projectId: string } | null {
    try {
        const u = new URL(dsn);
        const publicKey = u.username;
        const projectId = u.pathname.replace(/^\//, '').split('/')[0];
        if (!publicKey || !projectId) return null;
        return { publicKey, host: u.host, projectId };
    } catch {
        return null;
    }
}

export async function captureEdgeException(err: unknown, opts: CaptureOpts = {}): Promise<void> {
    if (!isActionableEdgeError(opts.status)) return;

    const dsn = Deno.env.get('SENTRY_DSN');
    if (!dsn) return;
    const parsed = parseDsn(dsn);
    if (!parsed) {
        console.error('[sentry] invalid SENTRY_DSN');
        return;
    }

    const { type, message } = describe(err);
    const stack = err instanceof Error ? err.stack : undefined;
    const release = Deno.env.get('SENTRY_RELEASE');
    const event = {
        event_id: crypto.randomUUID().replace(/-/g, ''),
        timestamp: Date.now() / 1000,
        platform: 'javascript',
        level: opts.level ?? 'error',
        server_name: 'fc-edge',
        environment: Deno.env.get('SENTRY_ENVIRONMENT') ?? 'production',
        release,
        tags: {
            runtime: 'edge',
            ...(opts.function ? { function: opts.function } : {}),
            ...opts.tags,
        },
        extra: opts.extra ? (scrubSensitive(opts.extra) as Record<string, unknown>) : undefined,
        exception: {
            values: [
                {
                    type,
                    value: scrubUrls(message),
                    stacktrace: stack
                        ? {
                              frames: stack
                                  .split('\n')
                                  .slice(1, 12)
                                  .map((line) => ({ filename: scrubUrls(line.trim()), function: '?' })),
                          }
                        : undefined,
                },
            ],
        },
    };

    const url = `https://${parsed.host}/api/${parsed.projectId}/store/`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);
    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Sentry-Auth': `Sentry sentry_version=7, sentry_key=${parsed.publicKey}, sentry_client=fc-edge/1.0`,
            },
            body: JSON.stringify(event),
            signal: controller.signal,
        });
        if (!res.ok) {
            console.error('[sentry] send failed', res.status);
        }
    } catch (sendErr) {
        console.error('[sentry] send failed', sendErr);
    } finally {
        clearTimeout(timeoutId);
    }
}

/** DB lookup/insert 실패처럼 throw 없이 500을 고르는 경로. 공개 메시지는 그대로, 원인은 Sentry만. */
export async function respondServerError(
    functionName: string,
    publicMessage: string,
    err?: unknown,
): Promise<Response> {
    await captureEdgeException(err ?? new Error(publicMessage), {
        function: functionName,
        status: 500,
    });
    return json500({ error: publicMessage });
}

function json500(body: Record<string, unknown>): Response {
    return new Response(JSON.stringify(body), {
        status: 500,
        headers: {
            'Access-Control-Allow-Origin': '*',
            'Content-Type': 'application/json',
        },
    });
}

export function serveWithSentry(
    functionName: string,
    handler: (req: Request) => Response | Promise<Response>,
): void {
    Deno.serve(async (req: Request) => {
        try {
            return await handler(req);
        } catch (err) {
            console.error(`[${functionName}] unhandled`, err);
            await captureEdgeException(err, { function: functionName, status: 500 });
            return json500({ error: 'Internal error' });
        }
    });
}
