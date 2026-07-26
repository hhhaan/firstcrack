import { useToastStore } from '@shared/store/toast';
import { AlertCircle, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

/** Global feedback surface. Sits above modals (ModalShell is z-1000). */
export const ToastViewport = () => {
    const { t } = useTranslation();
    const toasts = useToastStore((s) => s.toasts);
    const dismiss = useToastStore((s) => s.dismiss);

    if (toasts.length === 0) return null;

    return (
        <div
            role="status"
            aria-live="polite"
            className="pointer-events-none fixed bottom-6 left-1/2 z-1100 flex w-full max-w-[440px] -translate-x-1/2 flex-col gap-2 px-4"
        >
            {toasts.map((toast) => (
                <div
                    key={toast.id}
                    className="pointer-events-auto flex items-start gap-2.5 rounded-2xl border border-black/6 bg-[rgba(255,255,255,0.97)] px-4 py-3 shadow-[0_16px_40px_rgba(22,18,12,0.18)] backdrop-blur-[20px] dark:border-[#585d61] dark:bg-[#1a1e23]"
                >
                    <AlertCircle size={15} strokeWidth={2} className="mt-0.5 shrink-0 text-[#c0392b]" />
                    <p className="flex-1 text-[13px] leading-relaxed text-primary tracking-[0.14px] dark:text-[#e5e5e5]">
                        {toast.message}
                    </p>
                    <button
                        type="button"
                        onClick={() => dismiss(toast.id)}
                        aria-label={t('common.close')}
                        className="shrink-0 cursor-pointer rounded-full border-none bg-transparent p-1 text-muted transition-colors hover:text-primary"
                    >
                        <X size={14} strokeWidth={2} />
                    </button>
                </div>
            ))}
        </div>
    );
};
