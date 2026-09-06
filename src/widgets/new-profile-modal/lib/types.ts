/** A profile is always cut from a session: pick one, then name it. */
export type ProfileFormMode = 'session-list' | 'from-session';

export interface ProfileFormState {
    name: string;
    description: string;
    target_level: string;
}

export type ProfileDefaultType = 'bean' | 'blend' | 'none';

export const ROAST_LEVELS = ['Light', 'Medium-Light', 'Medium', 'Medium-Dark', 'Dark'] as const;

export const INITIAL_PROFILE_FORM: ProfileFormState = {
    name: '',
    description: '',
    target_level: 'Medium',
};
