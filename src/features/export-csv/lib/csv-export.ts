import type { RoastSessionWithRelations } from '@shared/types/database.types';

/** Escape a CSV field — wrap in quotes if it contains comma, quote, or newline. */
const escapeField = (val: string): string => {
    if (val.includes(',') || val.includes('"') || val.includes('\n') || val.includes('\r')) {
        return `"${val.replace(/"/g, '""')}"`;
    }
    return val;
};

/** Format duration in mm:ss for CSV (empty string for null, not em-dash). */
const formatDuration = (seconds: number | null): string => {
    if (seconds == null) return '';
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
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
    const outputKg = (s.weight_grams ?? 0) / 1000;
    const inputKg = outputKg / 0.82;
    const lossRate = inputKg > 0 ? ((inputKg - outputKg) / inputKg) * 100 : 0;

    return {
        date: s.roasted_at ? s.roasted_at.slice(0, 10) : '',
        bean: s.beans?.name ?? '',
        origin: s.beans?.origin ?? '',
        profile: s.roast_profiles?.name ?? '',
        weightGrams: s.weight_grams ?? 0,
        inputKg: Math.round(inputKg * 1000) / 1000,
        outputKg: Math.round(outputKg * 1000) / 1000,
        lossRate: Math.round(lossRate * 10) / 10,
        roastLevel: s.roast_level ?? '',
        dropTemp: s.drop_temp_celsius != null ? `${s.drop_temp_celsius}°C` : '',
        duration: formatDuration(s.duration_seconds),
        notes: s.notes ?? '',
    };
};

/** Convert an array of RoastSessionWithRelations to a CSV string with BOM. */
export const sessionsToCsv = (sessions: RoastSessionWithRelations[]): string => {
    const header = HEADERS.map((h) => HEADER_LABELS[h]).join(',') + '\n';

    const rows = sessions
        .map((s) => {
            const row = toCsvRow(s);
            return HEADERS.map((h) => escapeField(String(row[h]))).join(',');
        })
        .join('\n');

    return `\uFEFF${header}${rows}\n`;
};
