import { describe, expect, it } from 'vitest';
import { doorOpenSkipReason } from './doorOpenSkip';

const armed = {
    matched: true,
    switchOn: true,
    anySameKeySwitchOn: false,
    entitled: true,
    connected: true,
    reconnecting: false,
    supported: true,
};

describe('doorOpenSkipReason', () => {
    it('stays quiet when the matched machine switch is off', () => {
        expect(doorOpenSkipReason({ ...armed, switchOn: false })).toBeNull();
    });

    it('names an uncertain machine before any other block', () => {
        expect(doorOpenSkipReason({ ...armed, matched: false, switchOn: false, anySameKeySwitchOn: true })).toEqual({
            code: 'machine-unconfirmed',
            message: '연결된 기기를 확정하지 못해 문을 움직이지 않았습니다.',
        });
    });

    it('returns fixed codes for each armed skip path', () => {
        expect(doorOpenSkipReason({ ...armed, entitled: false })).toEqual({
            code: 'not-entitled',
            message: '기기 제어 권한이 없어 문을 움직이지 않았습니다.',
        });
        expect(doorOpenSkipReason({ ...armed, connected: false })).toEqual({
            code: 'link-unsettled',
            message: '연결이 확정되지 않아 문을 움직이지 않았습니다.',
        });
        expect(doorOpenSkipReason({ ...armed, supported: false })).toEqual({
            code: 'door-not-armed',
            message: '문 제어가 켜지지 않아 명령을 보내지 않았습니다.',
        });
    });
});
