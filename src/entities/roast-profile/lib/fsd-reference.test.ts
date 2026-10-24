import { formatRoastTsvRow, formatTsvRows, TSV_HEADER } from '@shared/lib/tsv-writer';
import type { TemperatureProcessing } from '@shared/types/sidecar';
import { describe, expect, it } from 'vitest';
import type { RoastProfileWithSource } from '../api';
import { buildFsdReference } from './fsd-reference';

const processing: TemperatureProcessing = {
    algorithm_version: 'ema-least-squares-v1',
    temperature_unit: 'C',
    ror_unit: 'C/min',
    timestamp_clock: 'sidecar-monotonic-seconds',
    display_ema_alpha: 0.3,
    ror_ema_alpha: 0.3,
    ror_window_sec: 30,
    ror_warmup_reads: 5,
};

const profile = (drop = 40): RoastProfileWithSource => ({
    id: 'profile',
    created_at: '2026-10-22',
    updated_at: '2026-10-22',
    user_id: 'workspace',
    name: 'Reference',
    description: null,
    source_session_id: 'source-session',
    target_level: 'Medium',
    charge_temp_celsius: 180,
    drop_temp_celsius: 205,
    duration_sec: drop,
    dev_time_sec: null,
    dev_pct: null,
    heater_events: null,
    machine_id: 'machine',
    machine_name: 'Virtual',
    machine_brand: null,
    machine_protocol: 'virtual',
    machine_roaster_key: 'virtual',
    default_bean_id: null,
    default_blend_id: null,
    sources: [],
    source_session: {
        tsv_path: 'source.tsv',
        events: [
            { id: 'charge', type: 'Charge', time_sec: 0 },
            { id: 'drop', type: 'Drop', time_sec: drop },
        ],
        machine_id: 'machine',
        machine_name: 'Virtual',
        machine_protocol: 'virtual',
        machine_roaster_key: 'virtual',
    },
    default_bean: null,
    default_blend: null,
});

const row = (time: number) => ({
    time,
    bt: time <= 22 ? 180 - time * 3 : 114 + (time - 22) * 2,
    et: null,
    heater: null,
    fan: 0,
    drum: 0,
    btRaw: time <= 22 ? 180 - time * 3 : 114 + (time - 22) * 2,
    sensorTimestamp: 1000 + time,
    sensorClock: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:1',
    processing,
});

const tsv = (count = 41) =>
    TSV_HEADER +
    formatTsvRows(
        Array.from({ length: count }, (_, index) => row(index)),
        formatRoastTsvRow,
    );

describe('buildFsdReference', () => {
    it('builds raw Celsius points and records the one allowed leading chart seed', () => {
        const seed = formatRoastTsvRow({ ...row(0), sensorTimestamp: null, sensorClock: null });
        const result = buildFsdReference(profile(), TSV_HEADER + seed + tsv().slice(TSV_HEADER.length));

        expect(result.reason).toBeNull();
        if (result.reference) {
            expect(result.reference.points[0]).toMatchObject({ elapsed_sec: 0, acquired_at: 1000, bt_c: 180 });
            expect(result.reference.source_machine).toEqual({
                machine_id: 'machine',
                roaster_key: 'virtual',
                protocol: 'virtual',
            });
            expect(result.diagnostics.excluded_chart_seed).toBe(true);
        }
    });

    it('rejects malformed or provenance-free measurement rows instead of dropping them', () => {
        const malformed = `${tsv()}bad\trow\n`;
        expect(buildFsdReference(profile(), malformed)).toMatchObject({ reason: 'malformed_tsv' });

        const missing = tsv().replace('\t1001\taaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:1\t', '\t\t\t');
        expect(buildFsdReference(profile(), missing)).toMatchObject({ reason: 'missing_provenance' });
    });

    it('enforces explicit boundaries, point-count limits, and monotonic gaps', () => {
        expect(buildFsdReference(profile(0), tsv())).toMatchObject({ reason: 'invalid_boundaries' });
        expect(buildFsdReference(profile(8), tsv(9))).toMatchObject({ reason: 'invalid_point_count' });
        const excessiveRows = Array.from({ length: 10_001 }, (_, index) => ({
            ...row(index / 10),
            bt: 150,
            btRaw: 150,
        }));
        const excessiveTsv = TSV_HEADER + formatTsvRows(excessiveRows, formatRoastTsvRow);
        expect(buildFsdReference(profile(1000), excessiveTsv)).toMatchObject({ reason: 'invalid_point_count' });

        const gapRows = [...Array.from({ length: 40 }, (_, index) => row(index)), row(44)];
        const gapTsv = TSV_HEADER + formatTsvRows(gapRows, formatRoastTsvRow);
        expect(buildFsdReference(profile(44), gapTsv)).toMatchObject({ reason: 'invalid_timing' });
    });

    it('rejects altered headers and malformed seed provenance without discarding the row', () => {
        expect(buildFsdReference(profile(), tsv().replace('bt_raw', 'display_bt'))).toMatchObject({
            reason: 'malformed_tsv',
        });
        const cells = formatRoastTsvRow({ ...row(0), sensorTimestamp: null, sensorClock: null })
            .replace(/\n$/, '')
            .split('\t');
        cells[11] = 'garbage';
        const damaged = `${TSV_HEADER}${cells.join('\t')}\n${tsv().slice(TSV_HEADER.length)}`;
        expect(buildFsdReference(profile(), damaged)).toMatchObject({ reason: 'missing_provenance' });
    });

    it('matches supported processing and sensor clock bounds without changing the raw record', () => {
        expect(
            buildFsdReference(profile(), tsv().replace('"ror_warmup_reads":5', '"ror_warmup_reads":0')),
        ).toMatchObject({ reason: 'unsupported_processing' });
        expect(
            buildFsdReference(profile(), tsv().replace('"display_ema_alpha":0.3', '"display_ema_alpha":0')),
        ).toMatchObject({ reason: null });
        expect(buildFsdReference(profile(), tsv().split(':1\t').join(':01\t'))).toMatchObject({
            reason: 'missing_provenance',
        });
        expect(
            buildFsdReference(
                profile(),
                tsv().split('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa').join('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'),
            ),
        ).toMatchObject({ reason: null });
    });

    it('requires qualified raw TP and a bounded filtered target after confirmation', () => {
        const rising = Array.from({ length: 41 }, (_, i) => ({ ...row(i), btRaw: 100 + i }));
        expect(buildFsdReference(profile(), TSV_HEADER + formatTsvRows(rising, formatRoastTsvRow))).toMatchObject({
            reason: 'reference_tp_missing',
        });
        const result = buildFsdReference(profile(), tsv());
        expect(result.reference && result.diagnostics.reference_tp_elapsed_sec).toBe(28);
        const excessive = Array.from({ length: 81 }, (_, i) => ({
            ...row(i),
            btRaw: i <= 22 ? 260 - (60 * i) / 22 : Math.min(260, 200 + (i - 22) * 3),
        }));
        expect(buildFsdReference(profile(80), TSV_HEADER + formatTsvRows(excessive, formatRoastTsvRow))).toMatchObject({
            reason: 'invalid_target_range',
        });
    });
});
