import { TSV_HEADER } from '@shared/lib/tsv-writer';
import type { FrozenReference, MachineIdentity, TemperatureProcessing } from '@shared/types/sidecar';
import { z } from 'zod';
import type { RoastProfileWithSource } from '../api';
import { resolveSourceSession } from './resolve-source-session';

export type FsdReferenceReason =
    | 'no_profile'
    | 'synthetic_source'
    | 'legacy_source'
    | 'download_failed'
    | 'malformed_tsv'
    | 'missing_provenance'
    | 'unsupported_processing'
    | 'missing_events'
    | 'invalid_boundaries'
    | 'invalid_point_count'
    | 'invalid_timing'
    | 'invalid_temperature'
    | 'missing_machine_identity'
    | 'reference_tp_missing'
    | 'invalid_target_range'
    | 'machine_mismatch';

export type FsdReferenceBuildResult =
    | {
          reference: FrozenReference;
          reason: null;
          diagnostics: { excluded_chart_seed: boolean; reference_tp_elapsed_sec: number };
      }
    | { reference: null; reason: Exclude<FsdReferenceReason, 'no_profile' | 'download_failed'> };

const processingSchema: z.ZodType<TemperatureProcessing> = z
    .object({
        read_units: z
            .object({
                heater: z.enum(['%', 'Pa', 'Hz', 'RPM']).optional(),
                fan: z.enum(['%', 'Pa', 'Hz', 'RPM']).optional(),
                drum: z.enum(['%', 'Pa', 'Hz', 'RPM']).optional(),
            })
            .strict()
            .optional(),
        algorithm_version: z.literal('ema-least-squares-v1'),
        temperature_unit: z.literal('C'),
        ror_unit: z.literal('C/min'),
        timestamp_clock: z.literal('sidecar-monotonic-seconds'),
        display_ema_alpha: z.number().finite().min(0).max(1),
        et_display_ema_alpha: z.number().finite().min(0).max(1).optional(),
        ror_ema_alpha: z.number().finite().min(0).max(1),
        et_ror_ema_alpha: z.number().finite().min(0).max(1).optional(),
        ror_window_sec: z.number().finite().positive(),
        ror_warmup_reads: z.number().int().positive(),
    })
    .strict();

const identitySchema = z
    .string()
    .max(128)
    .refine((value) => value.trim().length > 0);
const eventSchema = z.object({
    id: identitySchema,
    type: z.string(),
    time_sec: z.number().finite(),
});

const finiteColumn = (value: string | undefined): number | null => {
    if (value === undefined || value.trim() === '') return null;
    if (!/^-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value)) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
};

const sourceMachine = (profile: RoastProfileWithSource): MachineIdentity | null => {
    const source = resolveSourceSession(profile.source_session);
    const parsed = z
        .object({ machine_id: identitySchema, machine_roaster_key: identitySchema, machine_protocol: identitySchema })
        .safeParse(source);
    if (!parsed.success) return null;
    return {
        machine_id: parsed.data.machine_id,
        roaster_key: parsed.data.machine_roaster_key,
        protocol: parsed.data.machine_protocol,
    };
};

const boundaries = (profile: RoastProfileWithSource) => {
    const source = resolveSourceSession(profile.source_session);
    const parsed = z.array(eventSchema).safeParse(source?.events);
    if (!parsed.success) return null;
    const charges = parsed.data.filter((event) => event.type === 'Charge');
    const drops = parsed.data.filter((event) => event.type === 'Drop');
    if (charges.length !== 1 || drops.length !== 1) return null;
    return { charge: charges[0], drop: drops[0] };
};

export const buildFsdReference = (profile: RoastProfileWithSource, text: string): FsdReferenceBuildResult => {
    const source = resolveSourceSession(profile.source_session);
    if (!profile.source_session_id || !source?.tsv_path)
        return { reference: null, reason: source ? 'legacy_source' : 'synthetic_source' };
    if (!identitySchema.safeParse(profile.source_session_id).success)
        return { reference: null, reason: 'missing_provenance' };

    const machine = sourceMachine(profile);
    if (!machine) return { reference: null, reason: 'missing_machine_identity' };

    const marks = boundaries(profile);
    if (!marks) return { reference: null, reason: 'missing_events' };
    if (marks.charge.time_sec !== 0 || marks.drop.time_sec <= 0 || marks.drop.time_sec > 1800)
        return { reference: null, reason: 'invalid_boundaries' };

    const lines = text.split(/\r?\n/);
    if (lines[0] !== TSV_HEADER.trimEnd()) return { reference: null, reason: 'malformed_tsv' };

    let processing: TemperatureProcessing | null = null;
    let excludedChartSeed = false;
    const points: FrozenReference['points'][number][] = [];
    for (const line of lines.slice(1)) {
        if (!line) continue;
        if (line.startsWith('# processing\t')) {
            try {
                const parsed = processingSchema.safeParse(JSON.parse(line.slice('# processing\t'.length)));
                if (!parsed.success) return { reference: null, reason: 'unsupported_processing' };
                processing = parsed.data;
            } catch {
                return { reference: null, reason: 'unsupported_processing' };
            }
            continue;
        }
        if (line.startsWith('#')) return { reference: null, reason: 'malformed_tsv' };

        const cols = line.split('\t');
        if (cols.length !== 14) return { reference: null, reason: 'malformed_tsv' };
        const elapsed = finiteColumn(cols[0]);
        const acquired = finiteColumn(cols[11]);
        const sensorClock = cols[12] ?? '';
        if (elapsed === 0 && cols[11] === '' && sensorClock === '' && points.length === 0 && !excludedChartSeed) {
            excludedChartSeed = true;
            continue;
        }
        if (elapsed === null) return { reference: null, reason: 'malformed_tsv' };
        if (
            acquired === null ||
            sensorClock.length > 128 ||
            !/^[a-f0-9]{32}:(?:0|[1-9][0-9]*)$/i.test(sensorClock) ||
            !processing
        )
            return { reference: null, reason: 'missing_provenance' };
        const bt = finiteColumn(cols[9]);
        if (bt === null || bt < 0 || bt > 260) return { reference: null, reason: 'invalid_temperature' };
        points.push({ elapsed_sec: elapsed, acquired_at: acquired, sensor_clock: sensorClock, bt_c: bt, processing });
    }

    if (points.length < 10 || points.length > 10_000) return { reference: null, reason: 'invalid_point_count' };
    const first = points[0];
    const last = points[points.length - 1];
    if (first.elapsed_sec < 0 || first.elapsed_sec > 3 || last.elapsed_sec > marks.drop.time_sec)
        return { reference: null, reason: 'invalid_timing' };
    if (marks.drop.time_sec - last.elapsed_sec > 3) return { reference: null, reason: 'invalid_timing' };
    const offset = first.acquired_at - first.elapsed_sec;
    for (let index = 1; index < points.length; index += 1) {
        const previous = points[index - 1];
        const point = points[index];
        if (
            point.sensor_clock !== first.sensor_clock ||
            point.elapsed_sec <= previous.elapsed_sec ||
            point.acquired_at <= previous.acquired_at ||
            point.elapsed_sec - previous.elapsed_sec > 3 ||
            point.acquired_at - previous.acquired_at > 3 ||
            Math.abs(point.acquired_at - point.elapsed_sec - offset) > 1
        )
            return { reference: null, reason: 'invalid_timing' };
    }

    let minimum = first;
    let recoveryAt: number | null = null;
    let confirmedAt: number | null = null;
    let filtered = first.bt_c;
    for (let index = 0; index < points.length; index += 1) {
        const point = points[index];
        if (index > 0)
            filtered += -Math.expm1(-(point.acquired_at - points[index - 1].acquired_at) / 2) * (point.bt_c - filtered);
        if (confirmedAt === null) {
            if (point.bt_c <= minimum.bt_c) {
                minimum = point;
                recoveryAt = null;
            } else if (first.bt_c - minimum.bt_c < 5 || minimum.elapsed_sec < 20 || point.bt_c < minimum.bt_c + 2)
                recoveryAt = null;
            else {
                recoveryAt ??= point.acquired_at;
                if (point.acquired_at - recoveryAt >= 5) confirmedAt = point.elapsed_sec;
            }
        }
        if (confirmedAt !== null && (filtered < 50 || filtered > 250))
            return { reference: null, reason: 'invalid_target_range' };
    }
    if (confirmedAt === null) return { reference: null, reason: 'reference_tp_missing' };

    return {
        reference: {
            version: 'raw-bt-reference-v1',
            source: 'recorded_session',
            source_session_id: profile.source_session_id,
            source_machine: machine,
            temperature_unit: 'C',
            control_filter_version: 'raw-bt-dt-ema-v1',
            charge: { event_id: marks.charge.id, elapsed_sec: 0 },
            drop: { event_id: marks.drop.id, elapsed_sec: marks.drop.time_sec },
            points,
        },
        reason: null,
        diagnostics: { excluded_chart_seed: excludedChartSeed, reference_tp_elapsed_sec: confirmedAt },
    };
};
