import { create } from 'zustand';

export type ToastTone = 'error' | 'success' | 'info';

export interface ToastItem {
    id: string;
    message: string;
    tone: ToastTone;
}

const AUTO_DISMISS_MS = 6_000;
const MAX_VISIBLE = 3;
const timers = new Map<
    string,
    { timeout: ReturnType<typeof setTimeout>; remaining: number; startedAt: number | null }
>();

const startTimer = (id: string, remaining: number) => {
    timers.set(id, {
        timeout: setTimeout(() => useToastStore.getState().dismiss(id), remaining),
        remaining,
        startedAt: Date.now(),
    });
};

interface ToastState {
    toasts: ToastItem[];
    /** Session-only feedback — never persisted. Defaults to 'error' since most callers report failures. */
    show: (message: string, tone?: ToastTone) => void;
    dismiss: (id: string) => void;
    pause: (id: string) => void;
    resume: (id: string) => void;
}

export const useToastStore = create<ToastState>((set, get) => ({
    toasts: [],
    show: (message, tone = 'error') => {
        // A retried write failing the same way should not stack identical rows.
        if (get().toasts.some((toast) => toast.message === message)) return;
        const id = crypto.randomUUID();
        const oldest = get().toasts.length === MAX_VISIBLE ? get().toasts[0] : undefined;
        if (oldest) get().dismiss(oldest.id);
        set((state) => ({ toasts: [...state.toasts, { id, message, tone }].slice(-MAX_VISIBLE) }));
        startTimer(id, AUTO_DISMISS_MS);
    },
    dismiss: (id) => {
        const timer = timers.get(id);
        if (timer) clearTimeout(timer.timeout);
        timers.delete(id);
        set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) }));
    },
    pause: (id) => {
        const timer = timers.get(id);
        if (!timer || timer.startedAt === null) return;
        clearTimeout(timer.timeout);
        timers.set(id, {
            ...timer,
            remaining: Math.max(0, timer.remaining - (Date.now() - timer.startedAt)),
            startedAt: null,
        });
    },
    resume: (id) => {
        const timer = timers.get(id);
        if (timer && timer.startedAt === null) startTimer(id, timer.remaining);
    },
}));
