export type DiscardConfirmAction = 'request' | 'cancel' | 'confirm';

export interface DiscardConfirmResult {
    confirming: boolean;
    /** True only after explicit confirm — local TSV/session stay until then. */
    executeDiscard: boolean;
}

/** First Discard click only opens confirm. Wipe happens on confirm (#167 P0.2). */
export const reduceDiscardConfirm = (confirming: boolean, action: DiscardConfirmAction): DiscardConfirmResult => {
    switch (action) {
        case 'request':
            return { confirming: true, executeDiscard: false };
        case 'cancel':
            return { confirming: false, executeDiscard: false };
        case 'confirm':
            return { confirming: false, executeDiscard: confirming };
    }
};
