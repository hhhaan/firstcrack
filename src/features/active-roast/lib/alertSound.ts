import { logger } from '@shared/lib/logger';

/**
 * Roast alarm sounds, synthesized with Web Audio — no audio assets, no deps.
 *
 * Every kind is ~2 s, peak 0.9 and carries energy below 1.5 kHz so it stays audible over
 * roastery noise and with hearing protection (ISO 7731: pulsed, ≥2 s, <1500 Hz component).
 * The old 880 Hz sine at 0.18 decayed to silence in ~38 ms — a click, easy to miss on the floor.
 */
export const ALERT_SOUND_KINDS = ['pulse', 'chime', 'xylophone', 'pluck', 'marimba', 'kalimba', 'tubular'] as const;
export type AlertSoundKind = (typeof ALERT_SOUND_KINDS)[number];

export const isAlertSoundKind = (value: unknown): value is AlertSoundKind =>
    typeof value === 'string' && (ALERT_SOUND_KINDS as readonly string[]).includes(value);

/** Decay target for struck notes, −45 dB. */
const FLOOR = 0.005;
const G6 = 1568;
const C7 = 2093;
const E7 = 2637;
const G7 = 3136;

/** Additive voice: [frequency ratio, gain] pairs. Gains per kind sum to 0.9 peak (limiter guards the rest). */
type Partials = readonly (readonly [number, number])[];
const GLOCK: Partials = [
    [1, 0.5],
    [2.76, 0.12],
    [5.4, 0.05],
    [0.5, 0.23],
];
const XYLO: Partials = [
    [1, 0.55],
    [3, 0.15],
    [0.5, 0.2],
];
const MARIMBA: Partials = [
    [1, 0.5],
    [4, 0.15],
    [0.5, 0.25],
];
const KALIMBA: Partials = [
    [1, 0.55],
    [2, 0.1],
    [0.5, 0.25],
];
const TUBULAR: Partials = [
    [0.5, 0.2],
    [1, 0.3],
    [1.2, 0.12],
    [1.5, 0.1],
    [2, 0.12],
    [3, 0.06],
];

/** Reused across alarms — a context per alarm would leak until GC and can hit the per-page limit. */
let _ctx: AudioContext | null = null;
let _out: AudioNode | null = null;

const graph = () => {
    if (_ctx && _out) return { ctx: _ctx, out: _out };
    const ctx = new AudioContext();
    // Limiter, not the default music-compressor curve: summed voices must never clip.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -1;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.001;
    limiter.release.value = 0.05;
    limiter.connect(ctx.destination);
    _ctx = ctx;
    _out = limiter;
    return { ctx, out: limiter };
};

const resume = (ctx: AudioContext) => {
    if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
};

/** Create/resume the context before the first alarm. Call when alarms arm (Charge is a click). */
export const primeAlertAudio = () => {
    try {
        resume(graph().ctx);
    } catch (err) {
        logger.capture(err, { scope: 'alertSound.prime' });
    }
};

/** Gate with 8 ms exponential attack/release — a hard edge clicks. */
const fade = (ctx: AudioContext, dest: AudioNode, t: number, dur: number) => {
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(1, t + 0.008);
    env.gain.setValueAtTime(1, t + dur - 0.008);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    env.connect(dest);
    return env;
};

const tone = (
    ctx: AudioContext,
    dest: AudioNode,
    t: number,
    dur: number,
    { type, hz, gain }: { type: OscillatorType; hz: number; gain: number },
) => {
    const osc = ctx.createOscillator();
    const level = ctx.createGain();
    osc.type = type;
    osc.frequency.value = hz;
    level.gain.value = gain;
    osc.connect(level).connect(dest);
    osc.start(t);
    osc.stop(t + dur);
};

/** One struck note: sine partials with a shared exponential decay. */
const strike = (
    ctx: AudioContext,
    dest: AudioNode,
    t: number,
    hz: number,
    partials: Partials,
    decay: number,
    attack = 0.005,
) => {
    for (const [ratio, gain] of partials) {
        const osc = ctx.createOscillator();
        const level = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = hz * ratio;
        level.gain.setValueAtTime(0.0001, t);
        level.gain.exponentialRampToValueAtTime(gain, t + attack);
        level.gain.exponentialRampToValueAtTime(gain * FLOOR, t + decay);
        osc.connect(level).connect(dest);
        osc.start(t);
        osc.stop(t + decay);
    }
};

type Synth = (ctx: AudioContext, out: AudioNode, t0: number) => void;

const SYNTH: Record<AlertSoundKind, Synth> = {
    /** 4 Hz square pulses, 2500↔1900 Hz + 1250 Hz sub. Industrial default. */
    pulse(ctx, out, t0) {
        for (let i = 0; i < 8; i++) {
            const t = t0 + i * 0.25;
            const env = fade(ctx, out, t, 0.12);
            tone(ctx, env, t, 0.12, { type: 'square', hz: i % 2 ? 1900 : 2500, gain: 0.55 });
            tone(ctx, env, t, 0.12, { type: 'square', hz: 1250, gain: 0.35 });
        }
    },
    /** Glockenspiel C7 E7 G7 ascending, twice. */
    chime(ctx, out, t0) {
        for (const base of [0, 1.0]) {
            [C7, E7, G7].forEach((hz, i) => {
                strike(ctx, out, t0 + base + i * 0.16, hz, GLOCK, 0.7);
            });
        }
    },
    /** E7↔C7 trill at 8 Hz, wood 1:3 tuning. Best noise penetration of the soft set. */
    xylophone(ctx, out, t0) {
        for (let i = 0; i < 16; i++) strike(ctx, out, t0 + i * 0.125, i % 2 ? C7 : E7, XYLO, 0.2, 0.003);
    },
    /** Sawtooth G6 + D7 through a closing low-pass, 4 Hz. Warm but harmonic-rich. */
    pluck(ctx, out, t0) {
        for (let i = 0; i < 8; i++) {
            const t = t0 + i * 0.25;
            const env = fade(ctx, out, t, 0.15);
            const lp = ctx.createBiquadFilter();
            lp.type = 'lowpass';
            lp.Q.value = 2;
            lp.frequency.setValueAtTime(6000, t);
            lp.frequency.exponentialRampToValueAtTime(1200, t + 0.15);
            lp.connect(env);
            tone(ctx, lp, t, 0.15, { type: 'sawtooth', hz: 1568, gain: 0.5 });
            tone(ctx, lp, t, 0.15, { type: 'sawtooth', hz: 2349, gain: 0.4 });
        }
    },
    /** C7↔G6 roll at 10 Hz, 1:4 tuning. Most energy below 1.5 kHz. */
    marimba(ctx, out, t0) {
        for (let i = 0; i < 20; i++) strike(ctx, out, t0 + i * 0.1, i % 2 ? G6 : C7, MARIMBA, 0.25, 0.003);
    },
    /** Thumb-piano up/down melody G6 C7 E7 G7 E7 C7, twice. */
    kalimba(ctx, out, t0) {
        for (const base of [0, 1.0]) {
            [G6, C7, E7, G7, E7, C7].forEach((hz, i) => {
                strike(ctx, out, t0 + base + i * 0.15, hz, KALIMBA, 0.4, 0.002);
            });
        }
    },
    /** Tubular bell on C7, two strikes with 1.2 s ring. Calmest. */
    tubular(ctx, out, t0) {
        for (const t of [0, 1.0]) strike(ctx, out, t0 + t, C7, TUBULAR, 1.2);
    },
};

/** Play one ~2 s burst of `kind`. Safe to call without audio: errors are captured, the banner still shows. */
export const playAlertSound = (kind: AlertSoundKind) => {
    try {
        const { ctx, out } = graph();
        resume(ctx);
        SYNTH[kind](ctx, out, ctx.currentTime + 0.05);
    } catch (err) {
        logger.capture(err, { scope: 'roastAlerts.playSound' });
    }
};
