import type { ReactNode } from 'react';

export function SectionCard({ children }: { children: ReactNode }) {
    return (
        <section className="bg-white dark:bg-[#181d21] border border-[#E5E7EB] dark:border-[#585d61] rounded-xl p-5">
            {children}
        </section>
    );
}
