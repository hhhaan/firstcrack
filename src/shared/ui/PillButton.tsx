import type { ButtonHTMLAttributes, ReactNode } from 'react';

interface PillButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    children: ReactNode;
    /** 좌측 아이콘 */
    icon?: ReactNode;
}

/** Primary pill button — bg-primary, dark:bg-[#0d0d0d], dark:border-white, rounded-full */
export const PillButton = ({ children, icon, className = '', ...props }: PillButtonProps) => (
    <button
        {...props}
        className={`flex items-center gap-2 px-4.5 py-2.5 rounded-full border-none dark:border-white bg-primary dark:bg-[#0d0d0d] text-white text-sm font-medium cursor-pointer tracking-[0.14px] ${className}`}
    >
        {icon && <span className="flex items-center">{icon}</span>}
        {children}
    </button>
);
