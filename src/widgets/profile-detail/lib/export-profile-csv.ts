import type { RoastProfileWithSource } from '@entities/roast-profile';

export type ProfileCurvePoint = { t: number; bt: number };
export type ProfileCurveSource = 'session' | 'synthetic';

const escapeField = (val: string): string => {
    if (val.includes(',') || val.includes('"') || val.includes('\n') || val.includes('\r')) {
        return `"${val.replace(/"/g, '""')}"`;
    }
    return val;
};

const numOrEmpty = (v: number | null | undefined): string => (v == null ? '' : String(v));

/** Safe download basename (no extension). */
export const profileExportBasename = (name: string, date = new Date()): string => {
    const day = date.toISOString().slice(0, 10);
    const safe = name
        .trim()
        .replace(/[^\p{L}\p{N}\-_ .]+/gu, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .slice(0, 80)
        .replace(/^[-.]+|[-.]+$/g, '');
    return `${safe || 'profile'}-${day}`;
};

/** UTF-8 BOM + meta header + curve points (time_s, bt_c). */
export const profileToCsv = (
    profile: Pick<
        RoastProfileWithSource,
        | 'name'
        | 'description'
        | 'target_level'
        | 'charge_temp_celsius'
        | 'drop_temp_celsius'
        | 'duration_sec'
        | 'dev_time_sec'
        | 'dev_pct'
        | 'default_bean'
        | 'default_blend'
    >,
    curve: ProfileCurvePoint[],
    curveSource: ProfileCurveSource,
): string => {
    const metaHeaders = [
        'name',
        'description',
        'target_level',
        'charge_temp_celsius',
        'drop_temp_celsius',
        'duration_sec',
        'dev_time_sec',
        'dev_pct',
        'curve_source',
        'default_bean',
        'default_blend',
    ];
    const metaValues = [
        escapeField(profile.name),
        escapeField(profile.description ?? ''),
        escapeField(profile.target_level ?? ''),
        numOrEmpty(profile.charge_temp_celsius),
        numOrEmpty(profile.drop_temp_celsius),
        numOrEmpty(profile.duration_sec),
        numOrEmpty(profile.dev_time_sec),
        numOrEmpty(profile.dev_pct),
        curveSource,
        escapeField(profile.default_bean?.name ?? ''),
        escapeField(profile.default_blend?.name ?? ''),
    ];

    const curveRows = curve.map((p) => `${p.t},${p.bt}`);

    return '\uFEFF' + [metaHeaders.join(','), metaValues.join(','), '', 'time_s,bt_c', ...curveRows].join('\n');
};
