export type ProfileFormMode = 'pick' | 'manual' | 'from-session' | 'session-list';

export interface ProfileFormState {
    name: string;
    description: string;
    target_level: string;
    charge_temp_celsius: string;
    drop_temp_celsius: string;
    duration_sec: string;
    dev_time_sec: string;
    dev_pct: string;
}

export type ProfileDefaultType = 'bean' | 'blend' | 'none';

export const ROAST_LEVELS = ['Light', 'Medium-Light', 'Medium', 'Medium-Dark', 'Dark'] as const;

export const INITIAL_PROFILE_FORM: ProfileFormState = {
    name: '',
    description: '',
    target_level: 'Medium',
    charge_temp_celsius: '200',
    drop_temp_celsius: '200',
    duration_sec: '720',
    dev_time_sec: '90',
    dev_pct: '13',
};
