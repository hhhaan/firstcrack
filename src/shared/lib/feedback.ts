import type { ReadUnits } from '@shared/types/sidecar';

export type FeedbackRole = keyof ReadUnits;

export const feedbackUnit = (role: FeedbackRole, units?: ReadUnits): string =>
    units?.[role] ?? (role === 'drum' ? 'RPM' : '%');

export const feedbackLabel = (role: FeedbackRole, units?: ReadUnits): string =>
    role === 'fan' && units?.fan === 'Pa' ? 'Air pressure' : { heater: 'Heat', fan: 'Fan', drum: 'Drum' }[role];

/** A modern read map identifies absent channels; old recordings keep their legacy interpretation. */
export const feedbackValue = (
    value: number | null | undefined,
    role: FeedbackRole,
    units?: ReadUnits,
): number | null =>
    (units !== undefined && units[role] === undefined) || value == null || !Number.isFinite(value) ? null : value;

export const formatFeedback = (value: number, role: FeedbackRole, units?: ReadUnits): string =>
    `${Number(value.toFixed(2))} ${feedbackUnit(role, units)}`;
