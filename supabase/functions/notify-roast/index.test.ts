import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const { lookup, profileLookup, postSlack, serviceClient } = vi.hoisted(() => ({
    lookup: vi.fn(),
    profileLookup: vi.fn(),
    postSlack: vi.fn(),
    serviceClient: vi.fn(),
}));

vi.mock('../_shared/auth.ts', () => ({
    corsHeaders: { 'Access-Control-Allow-Origin': '*' },
    jsonResponse: (body: unknown, status = 200) => Response.json(body, { status }),
    serviceClient,
}));
vi.mock('../_shared/slack.ts', () => ({ postSlack }));

const sessionId = '11111111-1111-4111-8111-111111111111';
let handler: ((request: Request) => Promise<Response>) | undefined;
let env: Record<string, string>;

beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    env = { NOTIFY_ROAST_SECRET: 'test-roast-secret' };
    vi.stubGlobal('Deno', {
        env: { get: (key: string) => env[key] },
        serve: (callback: typeof handler) => {
            handler = callback;
        },
    });
    lookup.mockResolvedValue({
        data: {
            id: sessionId,
            user_id: 'owner',
            created_by: 'operator',
            status: 'completed',
            batch_name: '에티오피아 #1 · PR1',
            bean_label: '<!channel> coffee',
            weight_grams: 1500,
            roasted_at: '2026-11-06T15:30:00Z',
        },
        error: null,
    });
    profileLookup.mockResolvedValue({
        data: [
            { id: 'owner', display_name: '소유자', business_name: '테스트 로스터리' },
            { id: 'operator', display_name: '작업자 이름', business_name: '다른 회사' },
        ],
        error: null,
    });
    serviceClient.mockReturnValue({
        from: (table: string) => ({
            select: () =>
                table === 'roast_sessions' ? { eq: () => ({ maybeSingle: lookup }) } : { in: profileLookup },
        }),
    });
    postSlack.mockResolvedValue(true);
    await import('./index.ts');
});

afterEach(() => vi.unstubAllGlobals());

async function request(body: unknown = { session_id: sessionId }, secret: string | null = 'test-roast-secret') {
    if (!handler) throw new Error('Handler was not registered');
    return handler(
        new Request('https://edge.test/notify-roast', {
            method: 'POST',
            headers: secret ? { 'x-webhook-secret': secret } : {},
            body: JSON.stringify(body),
        }),
    );
}

it('fails closed for missing configuration, missing header and wrong secret', async () => {
    for (const secret of [null, 'incorrect']) expect((await request(undefined, secret)).status).toBe(401);
    delete env.NOTIFY_ROAST_SECRET;
    expect((await request()).status).toBe(401);
    expect(serviceClient).not.toHaveBeenCalled();
    expect(postSlack).not.toHaveBeenCalled();
});

it('rejects malformed or missing session ids without querying or sending', async () => {
    for (const body of [null, [], {}, { session_id: 123 }, { session_id: 'invalid' }]) {
        expect((await request(body)).status).toBe(400);
    }
    expect(serviceClient).not.toHaveBeenCalled();
    expect(postSlack).not.toHaveBeenCalled();
});

it('sends every completed save with final DB title and separate owner/operator labels', async () => {
    expect((await request({ session_id: sessionId, user_id: 'forged', batch_name: 'forged' })).status).toBe(200);
    expect((await request()).status).toBe(200);
    expect(postSlack).toHaveBeenCalledTimes(2);
    expect(postSlack.mock.calls[0][0]).toMatchObject({
        text: '로스팅이 저장되었습니다.',
        blocks: [
            {
                type: 'section',
                text: {
                    type: 'plain_text',
                    emoji: false,
                    text: expect.stringContaining('로스터리: 테스트 로스터리\n작업자: 작업자 이름'),
                },
            },
        ],
    });
    const text: string = postSlack.mock.calls[0][0].blocks[0].text.text;
    expect(text).toContain('에티오피아 #1 · PR1');
    expect(text).toContain('투입량: 1.5 kg');
    expect(text).toContain('<!channel> coffee');
    expect(text).toContain('2026. 11. 7.');
    expect(text).not.toContain('forged');
    expect(profileLookup).toHaveBeenCalledWith('id', ['owner', 'operator']);
});

it('skips deleted or uncompleted sessions', async () => {
    for (const data of [null, { status: 'in_progress' }]) {
        lookup.mockResolvedValue({ data, error: null });
        expect(await (await request()).json()).toEqual({ ok: true, skipped: true });
    }
    expect(postSlack).not.toHaveBeenCalled();
});

it('reports lookup and delivery failures without a successful acknowledgement', async () => {
    lookup.mockResolvedValueOnce({ data: null, error: { message: 'lookup unavailable' } });
    expect((await request()).status).toBe(500);
    profileLookup.mockResolvedValueOnce({ data: null, error: { message: 'profiles unavailable' } });
    expect((await request()).status).toBe(500);
    expect(postSlack).not.toHaveBeenCalled();
    postSlack.mockResolvedValue(false);
    expect((await request()).status).toBe(500);
});

it('handles absent optional metadata without attributing an unknown operator to the owner', async () => {
    lookup.mockResolvedValue({
        data: { id: sessionId, user_id: 'owner', created_by: null, status: 'completed', weight_grams: 0 },
        error: null,
    });
    profileLookup.mockResolvedValue({ data: [], error: null });
    expect((await request()).status).toBe(200);
    const text: string = postSlack.mock.calls[0][0].blocks[0].text.text;
    expect(text).toContain('로스터리: owner\n작업자: 알 수 없음\n배치: 이름 없음');
    expect(text).toContain('투입량: 0 kg');
});
