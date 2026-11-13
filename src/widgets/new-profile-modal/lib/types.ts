/** A profile is always cut from a session: pick one, then name it. */
export type ProfileFormMode = 'session-list' | 'from-session';

export interface ProfileFormState {
    name: string;
    description: string;
    target_level: string;
}

export { ROAST_LEVELS } from '@entities/profile';

export const INITIAL_PROFILE_FORM: ProfileFormState = {
    name: '',
    description: '',
    target_level: 'Medium',
};
