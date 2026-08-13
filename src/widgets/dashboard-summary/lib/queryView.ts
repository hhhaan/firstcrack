export type DashboardQueryView = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready' };

/** Any query failure is an error — never collapse to empty success (KPI 0). */
export function dashboardQueryErrorMessage(error: unknown): string | null {
    if (error == null) return null;
    if (typeof error === 'string' && error.length > 0) return error;
    if (
        typeof error === 'object' &&
        'message' in error &&
        typeof (error as { message: unknown }).message === 'string'
    ) {
        const msg = (error as { message: string }).message;
        if (msg) return msg;
    }
    return 'Failed to load';
}

export function resolveDashboardQueryView(input: { loading: boolean; error: string | null }): DashboardQueryView {
    if (input.error) return { status: 'error', message: input.error };
    if (input.loading) return { status: 'loading' };
    return { status: 'ready' };
}
