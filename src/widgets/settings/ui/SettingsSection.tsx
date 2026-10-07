import { cn } from '@shared/lib/cn';
import { SectionCard } from '@shared/ui/SectionCard';
import type { ReactNode } from 'react';

type SettingsSectionProps = { children: ReactNode; className?: string };

export function SettingsSection({ children, className }: SettingsSectionProps) {
    return (
        <section
            data-settings-section
            className={cn(
                'flex min-w-0 flex-col gap-2.5 in-[.settings-compact]:gap-2 in-[.settings-compact]:border-b in-[.settings-compact]:border-border in-[.settings-compact]:py-4 in-[.settings-compact]:first:pt-0 in-[.settings-compact]:last:border-b-0',
                className,
            )}
        >
            {children}
        </section>
    );
}

function SettingsSectionHeader({
    title,
    description,
    icon,
}: {
    title: ReactNode;
    description?: ReactNode;
    icon?: ReactNode;
}) {
    return (
        <header className="min-w-0">
            <h2 className="m-0 flex items-center gap-2 text-[13px] font-semibold text-primary">
                {icon && (
                    <span className="text-muted" aria-hidden>
                        {icon}
                    </span>
                )}
                {title}
            </h2>
            {description && <p className="m-0 mt-1 text-xs leading-relaxed text-muted">{description}</p>}
        </header>
    );
}

SettingsSection.Header = SettingsSectionHeader;

function SettingsSectionBody({ children, className }: SettingsSectionProps) {
    return (
        <SectionCard
            className={cn(
                'rounded-xl border-border-subtle p-4 in-[.settings-compact]:rounded-none in-[.settings-compact]:border-0 in-[.settings-compact]:p-0',
                className,
            )}
        >
            {children}
        </SectionCard>
    );
}

SettingsSection.Body = SettingsSectionBody;

export function SettingsRow({
    label,
    description,
    controlId,
    children,
}: {
    label: string;
    description?: string;
    controlId: string;
    children: ReactNode;
}) {
    return (
        <div className="flex min-w-0 flex-col gap-2 px-4 py-3 @[480px]:flex-row @[480px]:items-center @[480px]:justify-between @[480px]:gap-5">
            <div className="min-w-0 flex-1">
                <label htmlFor={controlId} className="text-[13px] font-medium text-primary">
                    {label}
                </label>
                {description && (
                    <p id={`${controlId}-description`} className="m-0 mt-0.5 text-xs leading-relaxed text-secondary">
                        {description}
                    </p>
                )}
            </div>
            <div className="flex min-w-0 max-w-full items-center gap-2 @[480px]:shrink-0">{children}</div>
        </div>
    );
}
