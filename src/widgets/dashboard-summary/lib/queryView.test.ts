import { describe, expect, it } from 'vitest';
import { dashboardQueryErrorMessage, resolveDashboardQueryView } from './queryView';

describe('dashboardQueryErrorMessage', () => {
    it('returns null when there is no error', () => {
        expect(dashboardQueryErrorMessage(null)).toBeNull();
        expect(dashboardQueryErrorMessage(undefined)).toBeNull();
    });

    it('reads Error and { message } without requiring instanceof Error', () => {
        expect(dashboardQueryErrorMessage(new Error('network down'))).toBe('network down');
        expect(dashboardQueryErrorMessage({ message: 'postgrest 500' })).toBe('postgrest 500');
        expect(dashboardQueryErrorMessage('offline')).toBe('offline');
    });

    it('treats unknown thrown values as an error, not empty success', () => {
        expect(dashboardQueryErrorMessage({})).toBe('Failed to load');
    });
});

describe('resolveDashboardQueryView', () => {
    it('treats a query error as error even when KPIs would be 0', () => {
        const view = resolveDashboardQueryView({ loading: false, error: 'network down' });
        expect(view).toEqual({ status: 'error', message: 'network down' });
        expect(view.status).not.toBe('ready');
    });

    it('error wins over loading so retry does not flash empty success', () => {
        expect(resolveDashboardQueryView({ loading: true, error: 'boom' }).status).toBe('error');
    });

    it('is loading only when there is no error', () => {
        expect(resolveDashboardQueryView({ loading: true, error: null })).toEqual({ status: 'loading' });
    });

    it('is ready only when there is no error and not loading', () => {
        expect(resolveDashboardQueryView({ loading: false, error: null })).toEqual({ status: 'ready' });
    });
});
