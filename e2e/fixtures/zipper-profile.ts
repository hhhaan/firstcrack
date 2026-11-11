import { E2E_USER } from './constants';

export const zipperE2eProfile = (sourceSessionId: string, sourceSession: Record<string, unknown> | null = null) => ({
    id: 'saved-profile',
    user_id: E2E_USER.id,
    name: 'ZIPPER',
    source_session_id: sourceSessionId,
    source_session: sourceSession,
    sources: [],
    duration_sec: 600,
    drop_temp_celsius: 200,
    target_level: 'Medium',
});
