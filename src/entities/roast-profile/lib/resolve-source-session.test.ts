import { describe, expect, it } from 'vitest';
import { profileHeaterEvents } from './resolve-source-session';

describe('profileHeaterEvents', () => {
    const sessionEdit = [{ t: 0, bt: 200, heater: 60 }];
    const profileEdit = [{ t: 0, bt: 200, heater: 80 }];
    const source = { tsv_path: 'a.tsv', heater_events: sessionEdit };

    it('profile override wins over the edited source record', () => {
        expect(profileHeaterEvents({ heater_events: profileEdit, source_session: source })).toBe(profileEdit);
    });

    it('does not borrow a missing plan from the source record', () => {
        expect(profileHeaterEvents({ heater_events: null, source_session: [source] })).toBeNull();
        expect(profileHeaterEvents({ heater_events: null, source_session: { tsv_path: 'a.tsv' } })).toBeNull();
        expect(profileHeaterEvents(null)).toBeNull();
    });
});
