import type { ControlRole } from './controlSender';

type Feedback = Record<ControlRole, number | null> | null;

/** A saved custom fan-% read map cannot supply feedback for pressure commands. */
export const controlFeedback = (
    feedback: Feedback,
    fanControlUnit: string | undefined,
    fanReadUnit: string | undefined,
): Feedback => {
    if (!feedback || fanControlUnit !== 'Pa' || fanReadUnit === 'Pa') return feedback;
    return { ...feedback, fan: null };
};
