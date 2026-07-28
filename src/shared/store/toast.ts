import { create } from 'zustand';

export type ToastTone = 'error' | 'success';

export interface ToastItem {
    id: string;
    message: string;
    tone: ToastTone;
}

const AUTO_DISMISS_MS = 6_000;
const MAX_VISIBLE = 3;

interface ToastState {
    toasts: ToastItem[];
    /** Session-only feedback — never persisted. Defaults to 'error' since most callers report failures. */
    show: (message: string, tone?: ToastTone) => void;
    dismiss: (id: string) => void;
}

export const useToastStore = create<ToastState>((set, get) => ({
    toasts: [],
    show: (message, tone = 'error') => {
        // A retried write failing the same way should not stack identical rows.
        if (get().toasts.some((toast) => toast.message === message)) return;
        const id = crypto.randomUUID();
        set((state) => ({ toasts: [...state.toasts, { id, message, tone }].slice(-MAX_VISIBLE) }));
        window.setTimeout(() => get().dismiss(id), AUTO_DISMISS_MS);
    },
    dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),
}));
