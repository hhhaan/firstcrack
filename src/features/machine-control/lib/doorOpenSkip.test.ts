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
        expect(doorOpenSkipReason({ ...armed, matched: false, switchOn: false, anySameKeySwitchOn: true })).toBe(
            '연결된 기기를 확정하지 못해 문을 움직이지 않았습니다.',
        );
    });

    it('says the release hold when the switch is on but the sidecar is not armed', () => {});
});
