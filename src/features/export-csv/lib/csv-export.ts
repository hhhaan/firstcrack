import { escapeCsvField } from '@shared/lib/csv';
import { formatDuration } from '@shared/lib/format';
import { sessionRoastMetrics } from '@shared/lib/roast-delta';
import { computeRoastWeights } from '@shared/lib/roastWeight';
import { sessionBeanName } from '@shared/lib/sessionBeanName';
import { sessionRoastTitle } from '@shared/lib/sessionRoastTitle';
import type { RoastSessionWithRelations } from '@shared/types/database.types';

export interface CsvRow {
    date: string;
    bean: string;
    origin: string;
    profile: string;
    weightGrams: number;
    inputKg: number;
    outputKg: number;
    lossRate: number;
    lossBasis: string;
    roastLevel: string;
    dropTemp: string;
    duration: string;
    notes: string;
    title: string;
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
    'lossBasis',
    'roastLevel',
    'dropTemp',
    'duration',
    'notes',
    'title',
];

const HEADER_LABELS: Record<keyof CsvRow, string> = {
    date: 'Date',
    bean: 'Bean',
    origin: 'Origin',
    profile: 'Profile',
    weightGrams: 'Green (g)',
    inputKg: 'Input (kg)',
    outputKg: 'Output (kg)',
    lossRate: 'Loss Rate (%)',
    lossBasis: 'Loss Basis',
    roastLevel: 'Roast Level',
    dropTemp: 'Drop Temp (°C)',
    duration: 'Duration',
    notes: 'Notes',
    title: 'Roast Title',
};

const toCsvRow = (s: RoastSessionWithRelations): CsvRow => {
    const { outputKg, inputKg, lossRate, measured } = computeRoastWeights(
        s.weight_grams,
        s.output_weight_grams,
        s.roast_level,
    );
    const roastSec = sessionRoastMetrics(s).roastDurationSec;

    return {
        date: s.roasted_at ? s.roasted_at.slice(0, 10) : '',
        bean: sessionBeanName(s) ?? '',
        origin: s.beans?.origin ?? '',
        profile: s.roast_profiles?.name ?? '',
        weightGrams: s.weight_grams ?? 0,
        inputKg,
        outputKg,
        lossRate,
        lossBasis: measured ? 'measured' : 'estimated',
        roastLevel: s.roast_level ?? '',
        dropTemp: s.drop_temp_celsius != null ? `${s.drop_temp_celsius}°C` : '',
        duration: roastSec != null ? formatDuration(roastSec) : '',
        notes: s.notes ?? '',
        title: sessionRoastTitle(s) ?? '',
    };
};

/** Convert an array of RoastSessionWithRelations to a CSV string with BOM. */
export const sessionsToCsv = (sessions: RoastSessionWithRelations[]): string => {
    const header = `${HEADERS.map((h) => HEADER_LABELS[h]).join(',')}\n`;

    const rows = sessions
        .map((s) => {
            const row = toCsvRow(s);
            return HEADERS.map((h) => escapeCsvField(String(row[h]))).join(',');
        })
        .join('\n');

    return `\uFEFF${header}${rows}\n`;
};
