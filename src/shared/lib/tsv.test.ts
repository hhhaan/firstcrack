import type { TemperatureProcessing } from '@shared/types/sidecar';
import { describe, expect, it, vi } from 'vitest';

const { reportTsvRestoreDroppedRows } = vi.hoisted(() => ({ reportTsvRestoreDroppedRows: vi.fn() }));
vi.mock('@shared/lib/sentry', () => ({ reportTsvRestoreDroppedRows }));

import { parseTsv } from './tsv';
import { formatRoastTsvRow, formatTsvRows, TSV_HEADER } from './tsv-writer';

const HEADER = 'time\tbt\tet\tror\theater\tfan\tdrum';

const none = {
    heater: null,
    fan: null,
    drum: null,
    heaterSet: null,
    etRaw: null,
    btRaw: null,
    rorEt: null,
    sensorTimestamp: null,
    sensorClock: null,
};

describe('parseTsv', () => {
    it('reports dropped extra-readings rows once per parse without file content', () => {
        reportTsvRestoreDroppedRows.mockClear();
        const row = ['0', '100', '', '', '', '', '', '', '', '', '', '', '', '{bad-json'].join('\t');
        const badExtra = `${HEADER}\n${row}`;
        parseTsv(badExtra);
        expect(reportTsvRestoreDroppedRows).toHaveBeenCalledOnce();
        expect(reportTsvRestoreDroppedRows).toHaveBeenCalledWith(1);
        const blob = JSON.stringify(reportTsvRestoreDroppedRows.mock.calls[0]);
        expect(blob).not.toMatch(/\.tsv|\/Users\//);
    });

    it('round-trips separate BT/ET EMA settings and reads legacy shared settings', () => {
        const processing = {
            algorithm_version: 'ema-least-squares-v1',
            temperature_unit: 'C',
            ror_unit: 'C/min',
            timestamp_clock: 'sidecar-monotonic-seconds',
            display_ema_alpha: 0.08,
            et_display_ema_alpha: 0.16,
            ror_ema_alpha: 0.2,
            ror_window_sec: 30,
            ror_warmup_reads: 3,
        };
        const row = '1\t180\t200\t5\t50\t30\t0\n';
        expect(parseTsv(`${TSV_HEADER}# processing\t${JSON.stringify(processing)}\n${row}`)[0].processing).toEqual(
            processing,
        );
        const { et_display_ema_alpha: _etAlpha, ...legacy } = processing;
        expect(parseTsv(`${TSV_HEADER}# processing\t${JSON.stringify(legacy)}\n${row}`)[0].processing).toEqual(legacy);
    });
    it('skips header and parses finite t/bt plus et/ror/heater/fan/drum', () => {
        const text = [HEADER, '0\t180.5\t200\t5.2\t50\t30\t0', '1.5\t185\t205.1\t4.0\t50\t30\t0', ''].join('\n');
        expect(parseTsv(text)).toEqual([
            {
                t: 0,
                bt: 180.5,
                et: 200,
                ror: 5.2,
                heater: 50,
                fan: 30,
                drum: 0,
                heaterSet: null,
                etRaw: null,
                btRaw: null,
                rorEt: null,
                sensorTimestamp: null,
                sensorClock: null,
            },
            {
                t: 1.5,
                bt: 185,
                et: 205.1,
                ror: 4,
                heater: 50,
                fan: 30,
                drum: 0,
                heaterSet: null,
                etRaw: null,
                btRaw: null,
                rorEt: null,
                sensorTimestamp: null,
                sensorClock: null,
            },
        ]);
    });

    it('nulls optional cols when missing or non-finite; keeps 0', () => {
        const text = [
            HEADER,
            '0\t100',
            '1\t110\t',
            '2\t120\tnan\tinf',
            '3\t130\t150\t',
            '4\t140\t160\t3.5',
            '5\t150\t160\t3.5\t0\t0\t0',
        ].join('\n');
        expect(parseTsv(text)).toEqual([
            { t: 0, bt: 100, et: null, ror: null, ...none },
            { t: 1, bt: 110, et: null, ror: null, ...none },
            { t: 2, bt: 120, et: null, ror: null, ...none },
            { t: 3, bt: 130, et: 150, ror: null, ...none },
            { t: 4, bt: 140, et: 160, ror: 3.5, ...none },
            {
                t: 5,
                bt: 150,
                et: 160,
                ror: 3.5,
                heater: 0,
                fan: 0,
                drum: 0,
                heaterSet: null,
                etRaw: null,
                btRaw: null,
                rorEt: null,
                sensorTimestamp: null,
                sensorClock: null,
            },
        ]);
    });

    it('parses the optional 8th heater_set column; blank stays null', () => {
        const text = [`${HEADER}\theater_set`, '0\t180\t200\t5\t50\t30\t0\t70', '1\t181\t200\t5\t50\t30\t0\t'].join(
            '\n',
        );
        expect(parseTsv(text).map((p) => p.heaterSet)).toEqual([70, null]);
    });

    it('parses the optional 9th et_raw column; blank stays null and -1 is kept', () => {
        const text = [
            `${HEADER}\theater_set\tet_raw`,
            '0\t180\t200\t5\t50\t30\t0\t70\t201.25',
            '1\t181\t200\t5\t50\t30\t0\t70\t',
            '2\t182\t200\t5\t50\t30\t0\t\t-1',
        ].join('\n');
        expect(parseTsv(text).map((p) => p.etRaw)).toEqual([201.25, null, -1]);
    });

    it('round-trips raw temperatures separately from display temperatures', () => {
        const row = formatRoastTsvRow({
            time: 1,
            bt: 180,
            et: 200,
            heater: null,
            fan: 0,
            drum: 0,
            etRaw: 201.25,
            btRaw: 179.75,
            ror_et: 3.25,
            sensorTimestamp: 123.456789,
            sensorClock: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:1',
        });
        const [point] = parseTsv(TSV_HEADER + row);
        expect(parseTsv((TSV_HEADER + row).replace(/\n/g, '\r\n'))).toEqual([point]);
        expect(point).toMatchObject({
            bt: 180,
            et: 200,
            etRaw: 201.25,
            btRaw: 179.75,
            rorEt: 3.25,
            sensorTimestamp: 123.456789,
            sensorClock: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:1',
        });
        expect(parseTsv(`${TSV_HEADER}2\t181\t200\t\t\t0\t0\t\t\tNaN\n`)[0].btRaw).toBeNull();
    });

    it('round-trips optional extra readings without rejecting malformed metadata', () => {
        const extraReadings = [
            { id: 'inlet-2', label: 'Inlet 2', unit: '°C', value: 187.5 },
            { id: 'pressure', label: 'Pressure', unit: 'Pa', value: null },
        ];
        const row = formatRoastTsvRow({
            time: 1,
            bt: 180,
            et: 200,
            heater: null,
            fan: 0,
            drum: 0,
            extraReadings,
        });

        expect(parseTsv(TSV_HEADER + row)[0].extraReadings).toEqual(extraReadings);
        expect(parseTsv(`${TSV_HEADER}1\t180\t\t\t\t\t\t\t\t\t\t\t\tbad-json\n`)[0]).not.toHaveProperty(
            'extraReadings',
        );
    });

    it('parses optional ET RoR, preserving zero and negative values', () => {
        const text =
            TSV_HEADER +
            ['3.25', '0', '-2', '', 'NaN', 'Infinity']
                .map((rorEt) => `1\t180\t200\t5\t50\t30\t0\t70\t201\t179\t${rorEt}\n`)
                .join('');
        expect(parseTsv(text).map((p) => p.rorEt)).toEqual([3.25, 0, -2, null, null, null]);
    });

    it('ignores invalid processing metadata without losing samples', () => {
        const row = formatRoastTsvRow({ time: 1, bt: 200, et: 210, heater: null, fan: 0, drum: 0 });
        for (const metadata of ['not-json', '{"ror_window_sec":-1}', 'null']) {
            const points = parseTsv(`${TSV_HEADER}# processing\t${metadata}\n${row}`);
            expect(points).toHaveLength(1);
            expect(points[0]).not.toHaveProperty('processing');
        }
    });

    it('drops rows with non-finite t or bt, short rows, and empty lines', () => {
        const text = [HEADER, '', 'onlyone', 'x\t100', '1\ty', 'NaN\t100', '2\tNaN', '3\t150\t160\t2'].join('\n');
        expect(parseTsv(text)).toEqual([{ t: 3, bt: 150, et: 160, ror: 2, ...none }]);
    });

    it('returns empty array for header-only or empty input', () => {
        expect(parseTsv(HEADER)).toEqual([]);
        expect(parseTsv('')).toEqual([]);
    });
});

it('retains changing physical feedback units through TSV serialization and reload', () => {
    const processing: TemperatureProcessing = {
        algorithm_version: 'ema-least-squares-v1',
        temperature_unit: 'C',
        ror_unit: 'C/min',
        timestamp_clock: 'sidecar-monotonic-seconds',
        display_ema_alpha: 1,
        ror_ema_alpha: 1,
        ror_window_sec: 30,
        ror_warmup_reads: 3,
        read_units: { heater: '%', fan: 'Pa', drum: 'Hz' },
    };
    const points = [
        { time: 0, bt: 190, et: 210, ror: 4, heater: 42.25, fan: 1234.56, drum: 31.25, processing },
        {
            time: 1,
            bt: 191,
            et: 210,
            ror: 4,
            heater: 42.25,
            fan: 40,
            drum: 50,
            processing: { ...processing, read_units: { fan: '%' as const, drum: 'RPM' as const } },
        },
    ];
    const result = parseTsv(TSV_HEADER + formatTsvRows(points, formatRoastTsvRow));
    expect(result[0]).toMatchObject({ heater: 42.25, fan: 1234.56, drum: 31.25, processing });
    expect(result[1].processing?.read_units).toEqual({ fan: '%', drum: 'RPM' });
    expect(result[1].heater).toBeNull();
    const emptyPoint = { ...points[0], heater: 0, fan: 0, drum: 0, processing: { ...processing, read_units: {} } };
    const emptyRow = formatRoastTsvRow(emptyPoint);
    expect(emptyRow.split('\t').slice(4, 7)).toEqual(['', '', '']);
    expect(parseTsv(TSV_HEADER + formatTsvRows([emptyPoint], formatRoastTsvRow))[0]).toMatchObject({
        heater: null,
        fan: null,
        drum: null,
    });
});
