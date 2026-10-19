import type { ReactNode } from 'react';

type PricingSectionProps = {
    step?: string;
    title: string;
    children: ReactNode;
};

export const PricingSection = ({ step, title, children }: PricingSectionProps) => (
    <section className="rounded-2xl border border-border bg-main-bg p-6 h-full flex flex-col">
        <div className="flex items-baseline gap-3 mb-5">
            {step && (
                <span className="text-[11px] font-medium uppercase tracking-[0.5px] text-muted tabular-nums">
                    {step}
                </span>
            )}
            <h2 className="text-[15px] font-medium text-primary tracking-[-0.15px]">{title}</h2>
        </div>
        {children}
    </section>
);
