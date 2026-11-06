import type { Database } from '../../../src/shared/types/database.types.ts';
import type { SlackPayload } from '../_shared/slack.ts';

export type NotificationRoast = Pick<
    Database['public']['Tables']['roast_sessions']['Row'],
    | 'id'
    | 'user_id'
    | 'created_by'
    | 'status'
    | 'batch_name'
    | 'profile_batch_number'
    | 'total_batch_number'
    | 'bean_label'
    | 'profile_id'
    | 'machine_name'
    | 'machine_brand'
    | 'weight_grams'
    | 'output_weight_grams'
    | 'duration_seconds'
    | 'events'
    | 'charge_temp_celsius'
    | 'drop_temp_celsius'
    | 'roast_level'
    | 'color_whole'
    | 'color_ground'
    | 'moisture_pct'
    | 'density_g_per_l'
    | 'ambient_temp_celsius'
    | 'ambient_humidity_pct'
    | 'notes'
    | 'roasted_at'
    | 'updated_at'
> & {
    beans?: { name: string } | null;
    blends?: { name: string } | null;
};
type Identity = Pick<Database['public']['Tables']['profiles']['Row'], 'display_name' | 'business_name'>;

const clip = (text: string, limit: number): string => (text.length > limit ? `${text.slice(0, limit - 1)}…` : text);
const plain = (text: string, limit = 2000) => ({ type: 'plain_text', text: clip(text, limit), emoji: false });
const field = (label: string, value: string) => plain(`${label}\n${value}`);
const numeric = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const number = (value: number) => value.toLocaleString('ko-KR', { maximumFractionDigits: 3 });
const measured = (value: number | null | undefined, unit: string) =>
    numeric(value) ? `${number(value)} ${unit}` : '—';
const kg = (value: number | null | undefined) => (numeric(value) ? measured(value / 1000, 'kg') : '미측정');
const duration = (value: number | null) => {
    if (value === null) return '—';
    const seconds = Math.round(value);
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};
const kst = (value: string | null) =>
    value && Number.isFinite(Date.parse(value))
        ? `${new Date(value).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} KST`
        : '—';

export function roastSlackPayload({
    roast,
    owner,
    actor,
    actorEmail,
    profileName,
}: {
    roast: NotificationRoast;
    owner: Identity | null;
    actor: Identity | null;
    actorEmail: string | null;
    profileName: string | null;
}): SlackPayload {
    const actorName = actor?.display_name || actorEmail || roast.created_by || '알 수 없음';
    const roastery = owner?.business_name || owner?.display_name || roast.user_id;
    const title = roast.batch_name || '이름 없는 배치';
    // Zero charge is the app's unset sentinel; output and QC zeros remain measurements.
    const charge = numeric(roast.weight_grams) && roast.weight_grams > 0 ? kg(roast.weight_grams) : '미입력';
    const coffee = roast.bean_label || roast.blends?.name || roast.beans?.name || '—';
    const machine = [roast.machine_brand, roast.machine_name].filter(Boolean).join(' · ') || '—';
    const marks: { type: string; time: number }[] = [];
    const events: unknown[] = Array.isArray(roast.events) ? roast.events : [];
    for (const event of events) {
        if (
            event !== null &&
            typeof event === 'object' &&
            'type' in event &&
            typeof event.type === 'string' &&
            'time_sec' in event &&
            numeric(event.time_sec) &&
            event.time_sec >= 0
        ) {
            marks.push({ type: event.type, time: event.time_sec });
        }
    }
    // Match History metrics: Charge-relative Drop, then End, then legacy duration.
    const total =
        marks.find((event) => event.type === 'Drop')?.time ??
        marks.find((event) => event.type === 'End')?.time ??
        (numeric(roast.duration_seconds) && roast.duration_seconds >= 0 ? roast.duration_seconds : null);
    const fc = marks.find((event) => event.type === 'FC Start')?.time;
    const development = total !== null && fc !== undefined && fc < total ? total - fc : null;
    const loss =
        numeric(roast.weight_grams) && roast.weight_grams > 0 && numeric(roast.output_weight_grams)
            ? `${(((roast.weight_grams - roast.output_weight_grams) / roast.weight_grams) * 100).toFixed(1)} %`
            : '—';
    const summary = [
        field('투입 → 배출', `${charge} → ${kg(roast.output_weight_grams)}`),
        field('감량률', loss),
        field('로스팅 시간', duration(total)),
        field(
            '투입 BT → 배출 BT',
            `${measured(roast.charge_temp_celsius, '°C')} → ${measured(roast.drop_temp_celsius, '°C')}`,
        ),
        field('로스팅 레벨', roast.roast_level || '—'),
        ...(development !== null && total !== null
            ? [field('디벨롭 · DTR', `${duration(development)} · ${((development / total) * 100).toFixed(1)} %`)]
            : []),
    ];
    const quality = [
        ...(roast.color_whole || roast.color_ground
            ? [field('색도 · 홀빈 / 분쇄', `${roast.color_whole || '—'} / ${roast.color_ground || '—'}`)]
            : []),
        ...(numeric(roast.moisture_pct) ? [field('수분율', measured(roast.moisture_pct, '%'))] : []),
        ...(numeric(roast.density_g_per_l) ? [field('밀도', measured(roast.density_g_per_l, 'g/L'))] : []),
        ...(numeric(roast.ambient_temp_celsius) || numeric(roast.ambient_humidity_pct)
            ? [
                  field(
                      '환경 · 온도 / 습도',
                      `${measured(roast.ambient_temp_celsius, '°C')} / ${measured(roast.ambient_humidity_pct, '%')}`,
                  ),
              ]
            : []),
    ];
    const fallback = clip(
        `${clip(actorName, 100)} · ${clip(title, 150)} · ${charge} 투입 → ${kg(roast.output_weight_grams)} 배출`,
        500,
    )
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    return {
        text: fallback,
        blocks: [
            { type: 'header', text: plain('로스팅 저장', 150) },
            { type: 'section', text: plain(title, 3000) },
            {
                type: 'section',
                fields: [
                    field('로스터리', roastery),
                    field(
                        '작업자',
                        actorEmail && actorEmail !== actorName ? `${clip(actorName, 300)}\n${actorEmail}` : actorName,
                    ),
                ],
            },
            { type: 'divider' },
            {
                type: 'section',
                fields: [
                    field('생두 / 블렌드', coffee),
                    field('참조 프로파일', profileName || '—'),
                    field('로스터', machine),
                    field(
                        '배치 번호 · 프로파일 / 전체',
                        `${roast.profile_batch_number ?? '—'} / ${roast.total_batch_number ?? '—'}`,
                    ),
                ],
            },
            { type: 'section', fields: summary },
            ...(quality.length ? [{ type: 'divider' }, { type: 'section', fields: quality }] : []),
            ...(roast.notes ? [{ type: 'section', text: plain(`메모\n${clip(roast.notes, 1000)}`, 3000) }] : []),
            { type: 'divider' },
            {
                type: 'context',
                elements: [
                    plain(`로스팅: ${kst(roast.roasted_at)}\n최근 저장/수정: ${kst(roast.updated_at)}`),
                    plain(`기록 ${roast.id}`),
                ],
            },
        ],
    };
}
