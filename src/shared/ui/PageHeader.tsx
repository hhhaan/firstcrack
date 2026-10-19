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
    <div className={`mb-7 flex flex-wrap items-end justify-between gap-5 ${className}`}>
        <div className="min-w-0">
            <h1 className="mb-2 font-(--font-display) text-[26px] leading-[1.2] tracking-[-0.5px] text-primary">
                {title}
            </h1>
            {subtitle && <p className="text-xs leading-relaxed text-muted">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
);
