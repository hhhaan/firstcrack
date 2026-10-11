import { cn } from '@shared/lib/cn';
import { selectIsAnyModalOpen, useModalStackStore } from '@shared/store/modalStack';
import { useToastStore } from '@shared/store/toast';
import { AlertCircle, CheckCircle, Info, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

/** Mirrors bottom-6 when no modal; clears centered modal footers (Roast Complete, etc.). */
export const TOAST_VIEWPORT_BOTTOM_CLASS = 'bottom-6';
export const TOAST_VIEWPORT_TOP_CLASS = 'top-6';

/** Global feedback surface. Above modal overlays (z-[10000]) and spotlight tour (z-[10050]). */
export const ToastViewport = () => {
    const { t } = useTranslation();
    const toasts = useToastStore((s) => s.toasts);
    const dismiss = useToastStore((s) => s.dismiss);
    const pause = useToastStore((s) => s.pause);
    const resume = useToastStore((s) => s.resume);
    const modalOpen = useModalStackStore(selectIsAnyModalOpen);

    if (toasts.length === 0) return null;

    return (
        <div
            data-toast-viewport=""
            data-modal-open={modalOpen ? 'true' : 'false'}
            className={cn(
                'pointer-events-none fixed left-1/2 z-[10051] flex w-full max-w-[440px] -translate-x-1/2 flex-col gap-2 px-4',
                modalOpen ? TOAST_VIEWPORT_TOP_CLASS : TOAST_VIEWPORT_BOTTOM_CLASS,
            )}
        >
            {toasts.map((toast) => (
                <div
                    key={toast.id}
                    role={toast.tone === 'error' ? 'alert' : 'status'}
                    onPointerEnter={() => pause(toast.id)}
                    onPointerLeave={(event) => {
                        if (!event.currentTarget.contains(document.activeElement)) resume(toast.id);
                    }}
                    onFocus={() => pause(toast.id)}
                    onBlur={(event) => {
                        if (
                            !event.currentTarget.contains(event.relatedTarget) &&
                            !event.currentTarget.matches(':hover')
                        )
                            resume(toast.id);
                    }}
                    className="pointer-events-auto flex items-start gap-2.5 rounded-xl border border-border-subtle bg-main-bg px-4 py-3 shadow-(--shadow-ring)"
                >
                    {toast.tone === 'success' ? (
                        <CheckCircle size={15} strokeWidth={2} className="mt-0.5 shrink-0 text-palette-green" />
                    ) : toast.tone === 'info' ? (
                        <Info size={15} strokeWidth={2} className="mt-0.5 shrink-0 text-palette-blue" />
                    ) : (
                        <AlertCircle
                            size={15}
                            strokeWidth={2}
                            className="mt-0.5 shrink-0 text-red-600 dark:text-red-400"
                        />
                    )}
                    <p className="min-w-0 flex-1 wrap-break-word text-[13px] leading-relaxed text-primary tracking-[0.14px]">
                        {toast.message}
                    </p>
                    <button
                        type="button"
                        onClick={() => dismiss(toast.id)}
                        aria-label={t('common.close')}
                        className="-m-1 shrink-0 cursor-pointer rounded-full border-none bg-transparent p-2 text-muted transition-colors hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-palette-blue"
                    >
                        <X size={14} strokeWidth={2} />
                    </button>
                </div>
            ))}
        </div>
    );
};
