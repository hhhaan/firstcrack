import { computeRoastWeights } from '@shared/lib/roastWeight';
import type { RoastSessionWithRelations } from '@shared/types/database.types';

export interface MonthlyReportData {
    year: number;
    month: number;
    businessName: string;
    ownerName: string;
    totalRoasts: number;
    totalInputKg: number;
    totalOutputKg: number;
    avgLossRate: number;
    sessions: {
        date: string;
        beanLot: string;
        inputKg: number;
        outputKg: number;
        lossRate: number;
        profile: string;
        worker: string;
    }[];
}

export const buildReportData = (
    rawSessions: RoastSessionWithRelations[],
    profileDisplayName: string | null | undefined,
    userEmail: string | null | undefined,
): MonthlyReportData => {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const workerName = profileDisplayName || userEmail || '';

    const monthSessions = rawSessions.filter((s) => {
        if (!s.roasted_at) return false;
        const d = new Date(s.roasted_at);
        return d.getFullYear() === year && d.getMonth() + 1 === month;
    });

    const sessions = monthSessions.map((s) => {
        const { outputKg, inputKg, lossRate } = computeRoastWeights(s.weight_grams);
        return {
            date: s.roasted_at ? s.roasted_at.slice(0, 10) : '',
            beanLot: s.beans?.name ?? '—',
            inputKg,
            outputKg,
            lossRate,
            profile: s.roast_profiles?.name ?? '—',
            worker: workerName,
        };
    });

    const totalInputKg = sessions.reduce((sum, s) => sum + s.inputKg, 0);
    const totalOutputKg = sessions.reduce((sum, s) => sum + s.outputKg, 0);
    const avgLossRate = totalInputKg > 0 ? ((totalInputKg - totalOutputKg) / totalInputKg) * 100 : 0;

    return {
        year,
        month,
        businessName: 'First Crack',
        ownerName: 'Admin',
        totalRoasts: sessions.length,
        totalInputKg: Math.round(totalInputKg * 1000) / 1000,
        totalOutputKg: Math.round(totalOutputKg * 1000) / 1000,
        avgLossRate: Math.round(avgLossRate * 10) / 10,
        sessions,
    };
};
