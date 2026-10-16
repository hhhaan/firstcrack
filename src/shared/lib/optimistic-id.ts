/** Client-only ids from optimistic creates (`opt_` + uuid). Never a Postgres uuid. */
export const OPTIMISTIC_ID_PREFIX = 'opt_';

/** Stable Sentry / client guard code — intentional refusal, not a production defect. */
export const OPTIMISTIC_ID_REFUSED_CODE = 'optimistic_id_refused';

export const isOptimisticId = (id: string | null | undefined): id is `opt_${string}` =>
    typeof id === 'string' && id.startsWith(OPTIMISTIC_ID_PREFIX);

/** Drop unsaved ids before they can be sent as uuid columns. */
export const persistedId = (id: string | null | undefined): string | null => (id && !isOptimisticId(id) ? id : null);

export class OptimisticIdRefusedError extends Error {
    readonly code = OPTIMISTIC_ID_REFUSED_CODE;

    constructor(message = 'Refusing request for an unsaved bean id') {
        super(message);
        this.name = 'OptimisticIdRefusedError';
    }
}

export const refuseOptimisticBeanId = (id: string, message?: string): void => {
    if (isOptimisticId(id)) throw new OptimisticIdRefusedError(message);
};
