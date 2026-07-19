import type { ReactNode } from 'react';

interface PageHeaderProps {
    title: ReactNode;
    subtitle?: ReactNode;
    /** 우측에 렌더링할 액션 영역 (버튼 등) */
    actions?: ReactNode;
    className?: string;
}

/** 페이지 헤더 — 좌측 타이틀/서브타이틀, 우측 액션 영역 구조를 공통화 */
export const PageHeader = ({ title, subtitle, actions, className = '' }: PageHeaderProps) => (
    <div className={`flex items-end justify-between mb-7 ${className}`}>
        <div>
            <h1 className="font-(--font-display) text-[32px] leading-[1.13] text-primary tracking-[-0.4px] mb-1.5">
                {title}
            </h1>
            {subtitle && <p className="text-sm text-muted tracking-[0.14px]">{subtitle}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center justify-end gap-2">{actions}</div>}
    </div>
);
