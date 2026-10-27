import { cn } from '@shared/lib/cn';
import { SectionCard } from '@shared/ui/SectionCard';
import type { ReactNode } from 'react';

type SettingsSectionProps = { children: ReactNode; className?: string; group?: string };

export function SettingsSection({ children, className, group }: SettingsSectionProps) {
    return (
        <section
            data-settings-section
            data-settings-group={group}
            className={cn('flex min-w-0 flex-col gap-3', className)}
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
            <h2 className="m-0 flex items-center gap-2 text-base font-medium leading-6 tracking-tight text-primary">
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
    return <SectionCard className={cn('rounded-2xl border-border p-4', className)}>{children}</SectionCard>;
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
        <div className="flex min-w-0 flex-col gap-2 px-4 py-4 @[480px]:flex-row @[480px]:items-center @[480px]:justify-between @[480px]:gap-5">
            <div className="min-w-0 flex-1">
                <label htmlFor={controlId} className="text-sm text-primary">
                    {label}
                </label>
                {description && (
                    <p id={`${controlId}-description`} className="m-0 mt-0.5 text-xs leading-relaxed text-muted">
                        {description}
                    </p>
                )}
            </div>
            <div className="flex min-w-0 max-w-full items-center gap-2 @[480px]:shrink-0">{children}</div>
        </div>
    );
}
