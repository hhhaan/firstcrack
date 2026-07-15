import type { ReactNode } from 'react';

type PricingSectionProps = {
    step?: string;
    title: string;
    children: ReactNode;
};

export const PricingSection = ({ step, title, children }: PricingSectionProps) => (
    <section className="bg-main-bg rounded-lg px-6 py-5 dark:border dark:border-border h-full flex flex-col">
        <div className="flex items-baseline gap-3 mb-5">
            {step && (
                <span className="text-[11px] font-medium uppercase tracking-[0.5px] text-muted tabular-nums">
                    {step}
                </span>
            )}
            <h2 className="font-display font-light text-[26px] text-primary tracking-[-0.3px]">{title}</h2>
        </div>
        {children}
    </section>
);
