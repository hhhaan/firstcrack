import { useState } from 'react';

/** Refresh clean fields without treating an older draft as a new edit. */
export const useFieldDraft = (stored: string) => {
    const [state, setState] = useState({ base: stored, draft: stored });
    if (state.base !== stored && (state.draft === state.base || state.draft === stored)) {
        setState({ base: stored, draft: stored });
    }
    return {
        draft: state.draft,
        dirty: state.draft !== state.base,
        conflict: state.draft !== state.base && state.base !== stored && state.draft !== stored,
        setDraft: (draft: string) => setState((previous) => ({ ...previous, draft })),
        resetDraft: () => setState({ base: stored, draft: stored }),
    };
};
