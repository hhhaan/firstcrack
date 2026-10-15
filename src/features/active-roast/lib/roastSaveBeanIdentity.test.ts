import { describe, expect, it } from 'vitest';
import type { SaveRoastParams } from '../model/save-roast-types';
import {
    assertGreenBeanSelectedForSave,
    isRoastSaveUserError,
    RoastSaveUserError,
    resolveRoastSaveBeanFields,
} from './roastSaveBeanIdentity';

const base: SaveRoastParams = {
    formData: { notes: '', weightGrams: 5, roastLevel: null, beanId: 'bean-1', deductStock: false },
    userId: 'u',
    elapsed: 1,
    roastStartTime: 1,
    rawBT: null,
    selectedBeanId: null,
    targetProfileId: null,
    planBatchHandoff: null,
    sessionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    handoffBeanName: null,
    logEntries: [],
};

describe('roastSaveBeanIdentity', () => {
    it('uses form beanId over stale selectedBeanId when label is empty', () => {
        const fields = resolveRoastSaveBeanFields({
            ...base,
            formData: { ...base.formData, beanId: 'picked-in-form' },
            selectedBeanId: 'stale-header',
        });
        expect(fields.resolvedBeanId).toBe('picked-in-form');
    });

    it('uses linked batch blend when form bean is empty', () => {
        const linkedBatch = {
            planBatchId: 'batch',
            planId: '',
            beanId: null,
            blendId: 'blend-1',
            beanName: 'Blend',
            batchSizeKg: 5,
            profileId: null,
            batchCount: 1,
            completedSessions: 0,
        };
        const fields = resolveRoastSaveBeanFields({
            ...base,
            formData: { ...base.formData, beanId: null, linkedBatch },
            selectedBeanId: null,
        });
        expect(fields.blendId).toBe('blend-1');
        expect(() =>
            assertGreenBeanSelectedForSave({
                ...base,
                formData: { ...base.formData, beanId: null, linkedBatch },
                selectedBeanId: null,
            }),
        ).not.toThrow();
    });

    it('rejects weight without bean, blend, or label', () => {
        expect(() =>
            assertGreenBeanSelectedForSave({
                ...base,
                formData: { ...base.formData, beanId: null, beanLabel: null },
                selectedBeanId: null,
            }),
        ).toThrow(RoastSaveUserError);
        try {
            assertGreenBeanSelectedForSave({
                ...base,
                formData: { ...base.formData, beanId: null, beanLabel: null },
                selectedBeanId: null,
            });
        } catch (err) {
            expect(isRoastSaveUserError(err)).toBe(true);
        }
    });
});
