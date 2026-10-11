import type { RoastProfileWithSource } from '@entities/roast-profile';
import { escapeCsvField } from '@shared/lib/csv';
import type { TsvPoint } from '@shared/lib/tsv';
import type { ExtraSensorReading } from '@shared/types/sidecar';

export type ProfileCurvePoint = Pick<TsvPoint, 't' | 'bt' | 'extraReadings'>;
export type ProfileCurveSource = 'session' | 'synthetic';

type ExtraSensorColumn = Pick<ExtraSensorReading, 'id' | 'label' | 'unit'> & { key: string };

const extraSensorKey = ({ id, label, unit }: Pick<ExtraSensorReading, 'id' | 'label' | 'unit'>) =>
    JSON.stringify([id, label, unit]);

export const profileExtraSensorColumns = (curve: ProfileCurvePoint[]): ExtraSensorColumn[] => {
    const columns = new Map<string, ExtraSensorColumn>();
    for (const point of curve) {
        for (const reading of point.extraReadings ?? []) {
            const key = extraSensorKey(reading);
            if (!columns.has(key)) columns.set(key, { key, id: reading.id, label: reading.label, unit: reading.unit });
        }
    }
    return [...columns.values()];
};

export const profileExtraSensorValue = (point: ProfileCurvePoint, key: string): number | null | undefined =>
    point.extraReadings?.find((reading) => extraSensorKey(reading) === key)?.value;

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
        escapeCsvField(profile.name),
        escapeCsvField(profile.description ?? ''),
        escapeCsvField(profile.target_level ?? ''),
        numOrEmpty(profile.charge_temp_celsius),
        numOrEmpty(profile.drop_temp_celsius),
        numOrEmpty(profile.duration_sec),
        numOrEmpty(profile.dev_time_sec),
        numOrEmpty(profile.dev_pct),
        curveSource,
        escapeCsvField(profile.default_bean?.name ?? ''),
        escapeCsvField(profile.default_blend?.name ?? ''),
    ];

    const extraColumns = profileExtraSensorColumns(curve);
    const curveHeaders = [
        'time_s',
        'bt_c',
        ...extraColumns.map((column) =>
            escapeCsvField(`${column.label} [${column.id}]${column.unit ? ` (${column.unit})` : ''}`),
        ),
    ];
    const curveRows = curve.map((point) =>
        [
            point.t,
            point.bt,
            ...extraColumns.map((column) => numOrEmpty(profileExtraSensorValue(point, column.key))),
        ].join(','),
    );

    return `\uFEFF${[metaHeaders.join(','), metaValues.join(','), '', curveHeaders.join(','), ...curveRows].join('\n')}`;
};
