export type AlertSoundTone = 'soft' | 'alarm';

export const ALERT_SOUND_TONES: readonly AlertSoundTone[] = ['soft', 'alarm'];

export const isAlertSoundTone = (v: unknown): v is AlertSoundTone => v === 'soft' || v === 'alarm';

/** Reused across beeps — a context per beep would leak until GC and can hit the per-page limit. */
let _audioCtx: AudioContext | null = null;

const pulse = (ctx: AudioContext, type: OscillatorType, freq: number, start: number, dur: number, amp: number) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(amp, start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(start);
    osc.stop(start + dur);
};

/** Web Audio oscillator — no sample files. `soft` is the original 880Hz sine. */
export const playAlertTone = (volumePct: number, tone: AlertSoundTone = 'soft') => {
    try {
        _audioCtx ??= new AudioContext();
        const ctx = _audioCtx;
        if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);

        const amp = Math.min(1, Math.max(0.05, volumePct / 100));
        const t = ctx.currentTime;
        if (tone === 'alarm') {
            for (let i = 0; i < 4; i++) pulse(ctx, 'square', i % 2 ? 1000 : 800, t + i * 0.1, 0.08, amp);
            return;
        }
        // Short ramp down — a hard stop clicks.
        pulse(ctx, 'sine', 880, t, 0.35, amp);
    } catch {
        // no audio device / autoplay blocked
    }
};
