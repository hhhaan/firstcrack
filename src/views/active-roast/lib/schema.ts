import { z } from 'zod';

export const roastSummarySchema = z.object({
    notes: z.string().max(2000, 'Notes are too long'),
    weightGrams: z.number().int().min(0, 'Weight must be 0 or greater'),
    roastLevel: z.string().nullable(),
});

export type RoastSummaryForm = z.infer<typeof roastSummarySchema>;
