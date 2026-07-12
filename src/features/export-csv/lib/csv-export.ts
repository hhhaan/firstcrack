import { formatDuration } from '@shared/lib/format';
import { computeRoastWeights } from '@shared/lib/roastWeight';
import type { RoastSessionWithRelations } from '@shared/types/database.types';

/** Escape a CSV field — wrap in quotes if it contains comma, quote, or newline. */
const escapeField = (val: string): string => {
    if (val.includes(',') || val.includes('"') || val.includes('\n') || val.includes('\r')) {
        return `"${val.replace(/"/g, '""')}"`;
    }
    return val;
};

export interface CsvRow {
    date: string;
    bean: string;
    origin: string;
    profile: string;
    weightGrams: number;
    inputKg: number;
    outputKg: number;
    lossRate: number;
    roastLevel: string;
    dropTemp: string;
    duration: string;
    notes: string;
}

const HEADERS: (keyof CsvRow)[] = [
    'date',
    'bean',
    'origin',
    'profile',
    'weightGrams',
    'inputKg',
    'outputKg',
    'lossRate',
    'roastLevel',
    'dropTemp',
    'duration',
    'notes',
];

const HEADER_LABELS: Record<keyof CsvRow, string> = {
    date: 'Date',
    bean: 'Bean',
    origin: 'Origin',
    profile: 'Profile',
    weightGrams: 'Weight (g)',
    inputKg: 'Input (kg)',
    outputKg: 'Output (kg)',
    lossRate: 'Loss Rate (%)',
    roastLevel: 'Roast Level',
    dropTemp: 'Drop Temp (°C)',
    duration: 'Duration',
    notes: 'Notes',
};

const toCsvRow = (s: RoastSessionWithRelations): CsvRow => {
    const { outputKg, inputKg, lossRate } = computeRoastWeights(s.weight_grams);

    return {
        date: s.roasted_at ? s.roasted_at.slice(0, 10) : '',
        bean: s.beans?.name ?? '',
        origin: s.beans?.origin ?? '',
        profile: s.roast_profiles?.name ?? '',
        weightGrams: s.weight_grams ?? 0,
        inputKg,
        outputKg,
        lossRate,
        roastLevel: s.roast_level ?? '',
        dropTemp: s.drop_temp_celsius != null ? `${s.drop_temp_celsius}°C` : '',
        duration: s.duration_seconds != null ? formatDuration(s.duration_seconds) : '',
        notes: s.notes ?? '',
    };
};

/** Convert an array of RoastSessionWithRelations to a CSV string with BOM. */
export const sessionsToCsv = (sessions: RoastSessionWithRelations[]): string => {
    const header = `${HEADERS.map((h) => HEADER_LABELS[h]).join(',')}\n`;

    const rows = sessions
        .map((s) => {
            const row = toCsvRow(s);
            return HEADERS.map((h) => escapeField(String(row[h]))).join(',');
        })
        .join('\n');

    return `\uFEFF${header}${rows}\n`;
};
