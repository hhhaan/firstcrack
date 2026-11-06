import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { NotificationRoast } from './message.ts';

const { lookup, profileLookup, authLookup, referenceLookup, postSlack, serviceClient } = vi.hoisted(() => ({
    lookup: vi.fn(),
    profileLookup: vi.fn(),
    authLookup: vi.fn(),
    referenceLookup: vi.fn(),
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
let roast: NotificationRoast;

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
    roast = {
        id: sessionId,
        user_id: 'owner',
        created_by: 'operator',
        status: 'completed',
        batch_name: '에티오피아 #1 · PR12',
        bean_label: '<!channel> coffee',
        weight_grams: 1500,
        roasted_at: '2026-11-06T15:30:00Z',
        updated_at: '2026-11-06T15:40:00Z',
        profile_batch_number: 1,
        total_batch_number: 12,
        profile_id: 'reference',
        machine_name: 'P12',
        machine_brand: 'Probat',
        output_weight_grams: 1275,
        duration_seconds: 660,
        events: [
            { type: 'FC Start', time_sec: 480 },
            { type: 'Drop', time_sec: 600 },
            { type: 'End', time_sec: 660 },
        ],
        charge_temp_celsius: 180,
        drop_temp_celsius: 205.5,
        roast_level: 'Medium',
        color_whole: '65',
        color_ground: '72',
        moisture_pct: 10.8,
        density_g_per_l: 730,
        ambient_temp_celsius: 22,
        ambient_humidity_pct: 40,
        notes: '깔끔한 단맛',
    };
    lookup.mockImplementation(async () => ({ data: roast, error: null }));
    profileLookup.mockResolvedValue({
        data: [
            { id: 'owner', display_name: '소유자', business_name: '테스트 로스터리' },
            { id: 'operator', display_name: '작업자 이름', business_name: '다른 회사' },
        ],
        error: null,
    });
    authLookup.mockResolvedValue({
        data: { user: { id: 'operator', email: 'operator@example.invalid' } },
        error: null,
    });
    referenceLookup.mockResolvedValue({ data: { name: '에티오피아 참조' }, error: null });
    serviceClient.mockReturnValue({
        auth: { admin: { getUserById: authLookup } },
        from: (table: string) => ({
            select: () =>
                table === 'roast_sessions'
                    ? { eq: () => ({ maybeSingle: () => ({ returns: lookup }) }) }
                    : table === 'profiles'
                      ? { in: profileLookup }
                      : { eq: () => ({ maybeSingle: referenceLookup }) },
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
    const text = JSON.stringify(postSlack.mock.calls[0][0]);
    expect(text).toContain('테스트 로스터리');
    expect(text).toContain('작업자 이름');
    expect(text).toContain('operator@example.invalid');
    expect(text).not.toContain('다른 회사');
    expect(text).toContain('에티오피아 #1 · PR12');
    expect(text).toContain('1.5 kg → 1.275 kg');
    expect(text).toContain('15.0 %');
    expect(text).toContain('10:00');
    expect(text).toContain('2:00 · 20.0 %');
    expect(text).toContain('180 °C → 205.5 °C');
    expect(text).toContain('에티오피아 참조');
    expect(text).toContain('Probat · P12');
    expect(text).toContain('1 / 12');
    expect(text).toContain('65 / 72');
    expect(text).toContain('10.8 %');
    expect(text).toContain('730 g/L');
    expect(text).toContain('로스팅 레벨');
    expect(text).toContain('수분율');
    expect(text).toContain('밀도');
    expect(text).toContain('최근 저장/수정');
    expect(text).toContain('깔끔한 단맛');
    expect(text).toContain('<!channel> coffee');
    expect(text).toContain('2026. 11. 7.');
    expect(text).not.toContain('forged');
    expect(profileLookup).toHaveBeenCalledWith('id', ['owner', 'operator']);
    expect(authLookup).toHaveBeenCalledWith('operator');
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
    expect(postSlack).not.toHaveBeenCalled();
    postSlack.mockResolvedValue(false);
    expect((await request()).status).toBe(500);
});

it('handles absent optional metadata without attributing an unknown operator to the owner', async () => {
    roast.created_by = null;
    roast.batch_name = null;
    roast.weight_grams = 0;
    roast.output_weight_grams = null;
    profileLookup.mockResolvedValue({ data: [], error: null });
    expect((await request()).status).toBe(200);
    const text = JSON.stringify(postSlack.mock.calls[0][0]);
    expect(text).toContain('owner');
    expect(text).toContain('알 수 없음');
    expect(text).toContain('이름 없는 배치');
    expect(text).toContain('미입력 → 미측정');
    expect(text).not.toContain('operator@example.invalid');
    expect(authLookup).not.toHaveBeenCalled();
});

it('formats zero output defensively and keeps loss unavailable without positive charge', async () => {
    roast.output_weight_grams = 0;
    expect((await request()).status).toBe(200);
    expect(JSON.stringify(postSlack.mock.calls[0][0])).toContain('1.5 kg → 0 kg');
    expect(JSON.stringify(postSlack.mock.calls[0][0])).toContain('100.0 %');
    roast.weight_grams = 0;
    expect((await request()).status).toBe(200);
    const text = JSON.stringify(postSlack.mock.calls[1][0]);
    expect(text).toContain('미입력 → 0 kg');
    expect(text).not.toContain('100.0 %');
    expect(text).not.toContain('NaN');
    expect(text).not.toContain('Infinity');
});

it('delivers the roast when optional identity/reference lookups fail', async () => {
    profileLookup.mockRejectedValue(new Error('profile transport failure'));
    authLookup.mockResolvedValue({ data: { user: null }, error: { message: 'auth unavailable' } });
    referenceLookup.mockRejectedValue(new Error('reference transport failure'));
    expect((await request()).status).toBe(200);
    const text = JSON.stringify(postSlack.mock.calls[0][0]);
    expect(text).toContain('operator');
    expect(text).toContain('owner');
    expect(text).toContain('1.5 kg → 1.275 kg');
    expect(text).not.toContain('failure');
    expect(text).not.toContain('auth unavailable');
});

it('uses canonical Auth email as operator fallback and never trusts another user email', async () => {
    profileLookup.mockResolvedValue({ data: [], error: null });
    expect((await request()).status).toBe(200);
    expect(postSlack.mock.calls[0][0].text).toContain('operator@example.invalid');
    authLookup.mockResolvedValue({ data: { user: { id: 'owner', email: 'owner@example.invalid' } }, error: null });
    expect((await request()).status).toBe(200);
    expect(JSON.stringify(postSlack.mock.calls[1][0])).not.toContain('owner@example.invalid');
});

it('falls back from Drop to End to duration and ignores invalid FC timing', async () => {
    roast.events = [
        { type: 'FC Start', time_sec: 480 },
        { type: 'End', time_sec: 660 },
    ];
    expect((await request()).status).toBe(200);
    expect(JSON.stringify(postSlack.mock.calls[0][0])).toContain('3:00 · 27.3 %');
    roast.events = [
        { type: 'Drop', time_sec: -1 },
        { type: 'FC Start', time_sec: 700 },
    ];
    expect((await request()).status).toBe(200);
    const text = JSON.stringify(postSlack.mock.calls[1][0]);
    expect(text).toContain('11:00');
    expect(text).not.toContain('디벨롭');
    roast.events = null;
    roast.duration_seconds = null;
    roast.output_weight_grams = null;
    roast.roasted_at = null;
    roast.updated_at = 'invalid';
    expect((await request()).status).toBe(200);
    const missing = JSON.stringify(postSlack.mock.calls[2][0]);
    expect(missing).not.toContain('Invalid Date');
    expect(missing).not.toContain('디벨롭');
    expect(missing).not.toContain('15.0 %');
});

it('falls back to stored coffee names and preserves zero-valued optional measurements', async () => {
    roast.bean_label = null;
    roast.blends = { name: '하우스 블렌드' };
    roast.beans = { name: '원산지 생두' };
    roast.moisture_pct = 0;
    roast.ambient_temp_celsius = 0;
    roast.ambient_humidity_pct = 0;
    roast.color_whole = '0';
    expect((await request()).status).toBe(200);
    const text = JSON.stringify(postSlack.mock.calls[0][0]);
    expect(text).toContain('하우스 블렌드');
    expect(text).toContain('0 °C / 0 %');
    expect(text).toContain('0 / 72');
    expect(text).not.toContain('원산지 생두');
});

it('keeps untrusted values plain, escapes fallback mentions and stays within Slack limits', async () => {
    const untrusted = `<!channel> & <https://evil.invalid|link>${'가'.repeat(5000)}`;
    roast.batch_name = untrusted;
    roast.bean_label = untrusted;
    roast.machine_name = untrusted;
    roast.notes = untrusted;
    roast.color_whole = untrusted;
    profileLookup.mockResolvedValue({
        data: [{ id: 'operator', display_name: untrusted, business_name: null }],
        error: null,
    });
    referenceLookup.mockResolvedValue({ data: { name: untrusted }, error: null });
    expect((await request()).status).toBe(200);
    const sent = postSlack.mock.calls[0][0];
    expect(sent.text).not.toContain('<!channel>');
    expect(sent.text).toContain('&lt;!channel&gt; &amp; &lt;https://evil.invalid|link&gt;');
    expect(sent.text).toContain('1.5 kg 투입 → 1.275 kg 배출');
    expect(sent.blocks.length).toBeLessThan(50);
    for (const block of sent.blocks) {
        if (block.text) {
            expect(block.text.type).toBe('plain_text');
            expect(block.text.text.length).toBeLessThanOrEqual(block.type === 'header' ? 150 : 3000);
        }
        if (block.fields) {
            expect(block.fields.length).toBeLessThanOrEqual(10);
            for (const field of block.fields) {
                expect(field.type).toBe('plain_text');
                expect(field.text.length).toBeLessThanOrEqual(2000);
            }
        }
        if (block.elements) {
            for (const element of block.elements) {
                expect(element.type).toBe('plain_text');
                expect(element.text.length).toBeLessThanOrEqual(2000);
            }
        }
    }
});
