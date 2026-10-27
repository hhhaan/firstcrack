import { describe, expect, it } from 'vitest';
import { profileHeaterEvents } from './resolve-source-session';

describe('profileHeaterEvents', () => {
    const sessionEdit = [{ t: 0, bt: 200, heater: 60 }];
    const profileEdit = [{ t: 0, bt: 200, heater: 80 }];
    const source = { tsv_path: 'a.tsv', heater_events: sessionEdit };

    it('uses the source roast record, not a plan stored on the profile', () => {
        expect(profileHeaterEvents({ heater_events: profileEdit, source_session: source })).toBe(sessionEdit);
        expect(profileHeaterEvents({ heater_events: profileEdit, source_session: [source] })).toBe(sessionEdit);
    });

    it('has no saved heat when the roast record has none', () => {
        expect(profileHeaterEvents({ heater_events: profileEdit, source_session: { tsv_path: 'a.tsv' } })).toBeNull();
        expect(profileHeaterEvents(null)).toBeNull();
    });
});
