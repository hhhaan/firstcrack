import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ALERT_SOUND_KINDS, playAlertSound } from './alertSound';

/** Minimal Web Audio stand-in: records every scheduled start() so we can see the burst shape. */
const started: number[] = [];

class Param {
    value = 0;
    setValueAtTime = vi.fn();
    exponentialRampToValueAtTime = vi.fn();
    linearRampToValueAtTime = vi.fn();
}
class Node {
    type = 'sine';
    gain = new Param();
    frequency = new Param();
    Q = new Param();
    threshold = new Param();
    knee = new Param();
    ratio = new Param();
    attack = new Param();
    release = new Param();
    connect<T>(dest: T) {
        return dest;
    }
    start(t = 0) {
        started.push(t);
    }
    stop() {}
}
class FakeAudioContext {
    currentTime = 0;
    state = 'running';
    destination = new Node();
    createOscillator = () => new Node();
    createGain = () => new Node();
    createDynamicsCompressor = () => new Node();
    createBiquadFilter = () => new Node();
    resume = () => Promise.resolve();
}

describe('playAlertSound', () => {
    beforeEach(() => {
        vi.stubGlobal('AudioContext', FakeAudioContext);
        started.length = 0;
    });
    afterEach(() => vi.unstubAllGlobals());

    it.each(ALERT_SOUND_KINDS)('%s schedules a multi-note burst spanning at least 1 s', (kind) => {
        playAlertSound(kind);
        expect(started.length).toBeGreaterThan(1);
        expect(Math.max(...started) - Math.min(...started)).toBeGreaterThanOrEqual(1);
    });
});
