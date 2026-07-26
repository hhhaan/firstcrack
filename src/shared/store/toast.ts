import { create } from 'zustand';

export interface ToastItem {
    id: string;
    message: string;
}

const AUTO_DISMISS_MS = 6_000;
const MAX_VISIBLE = 3;

interface ToastState {
    toasts: ToastItem[];
    /** Session-only feedback — never persisted. */
    show: (message: string) => void;
    dismiss: (id: string) => void;
}

export const useToastStore = create<ToastState>((set, get) => ({
    toasts: [],
    show: (message) => {
        // A retried write failing the same way should not stack identical rows.
        if (get().toasts.some((toast) => toast.message === message)) return;
        const id = crypto.randomUUID();
        set((state) => ({ toasts: [...state.toasts, { id, message }].slice(-MAX_VISIBLE) }));
        window.setTimeout(() => get().dismiss(id), AUTO_DISMISS_MS);
    },
    dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),
}));
