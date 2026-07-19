import { cn } from '@shared/lib/cn';
import { selectCls } from '@shared/ui/form-styles';
import { ChevronDown } from 'lucide-react';
import { forwardRef, type SelectHTMLAttributes } from 'react';

type FormSelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
    /** Outer wrapper (relative container for chevron). */
    wrapperClassName?: string;
};

/**
 * Modal/form native select — same surface as `inputCls`, custom chevron.
 * Prefer over bare `<select className={inputCls}>` (OS arrow + no pr).
 */
export const FormSelect = forwardRef<HTMLSelectElement, FormSelectProps>(
    ({ className, wrapperClassName, children, ...props }, ref) => (
        <div className={cn('relative', wrapperClassName)}>
            <select ref={ref} className={cn(selectCls, className)} {...props}>
                {children}
            </select>
            <ChevronDown
                size={16}
                strokeWidth={2}
                aria-hidden
                className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-muted dark:text-[#8a8580]"
            />
        </div>
    ),
);
FormSelect.displayName = 'FormSelect';
