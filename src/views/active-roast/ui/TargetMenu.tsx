import { Popover, PopoverContent, PopoverTrigger } from '@shared/ui/popover/Popover';
import { Check, ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

const itemCls =
    'relative flex w-full min-w-0 cursor-pointer items-center overflow-hidden rounded-md py-1.5 pr-2.5 pl-7 text-left text-[13px] tracking-[0.14px] text-secondary hover:bg-surface hover:text-primary';
const checkedCls = 'font-medium text-primary';

const linkCls =
    'cursor-pointer border-none bg-transparent p-0 text-[13px] tracking-[0.14px] text-muted underline decoration-border underline-offset-[3px]';

export const TargetMenu = ({
    profiles,
    targetProfileId,
    historyReferenceName = null,
    disabled = false,
    onProfileChange,
    onChooseHistory,
}: {
    profiles: { id: string; name: string }[];
    targetProfileId: string | null;
    historyReferenceName?: string | null;
    disabled?: boolean;
    onProfileChange: (id: string | null) => void;
    onChooseHistory?: () => void;
}) => {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const profileName =
        profiles.find((profile) => profile.id === targetProfileId)?.name ?? t('activeRoast.header.noTarget');
    const label = historyReferenceName ?? profileName;

    const choose = (id: string | null) => {
        setOpen(false);
        onProfileChange(id);
    };
    const run = (action: () => void) => {
        setOpen(false);
        action();
    };

    return (
        <Popover open={!disabled && open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    disabled={disabled}
                    aria-label={t('activeRoast.header.target')}
                    className="inline-flex max-w-full cursor-pointer items-center gap-1 border-none bg-transparent p-0 text-primary outline-none focus-visible:ring-1 focus-visible:ring-primary/20 disabled:cursor-default"
                >
                    <span className="min-w-0 truncate text-[13px] font-medium tracking-[0.14px]">{label}</span>
                    <ChevronDown size={12} className="shrink-0 text-muted" />
                </button>
            </PopoverTrigger>
            <PopoverContent
                align="start"
                sideOffset={6}
                className="w-80 overflow-hidden rounded-lg border border-black/15 bg-main-bg p-1 shadow-[0_2px_10px_rgba(0,0,0,0.06)]"
            >
                <div className="max-h-56 overflow-x-hidden overflow-y-auto">
                    <button
                        type="button"
                        className={`${itemCls} ${!historyReferenceName && !targetProfileId ? checkedCls : ''}`}
                        aria-current={!historyReferenceName && !targetProfileId ? 'true' : undefined}
                        onClick={() => choose(null)}
                    >
                        {!historyReferenceName && !targetProfileId && <MenuCheck />}
                        {t('activeRoast.header.noTarget')}
                    </button>
                    {profiles.map((profile) => {
                        const checked = !historyReferenceName && profile.id === targetProfileId;
                        return (
                            <button
                                key={profile.id}
                                type="button"
                                className={`${itemCls} ${checked ? checkedCls : ''}`}
                                aria-current={checked ? 'true' : undefined}
                                onClick={() => choose(profile.id)}
                            >
                                {checked && <MenuCheck />}
                                <span className="min-w-0 flex-1 truncate">{profile.name}</span>
                            </button>
                        );
                    })}
                </div>
                {onChooseHistory && (
                    <div className="border-t border-border-subtle bg-main-bg px-2.5 py-1.5">
                        <button type="button" className={linkCls} onClick={() => run(onChooseHistory)}>
                            {t('activeRoast.reference.choose')}
                        </button>
                    </div>
                )}
            </PopoverContent>
        </Popover>
    );
};

const MenuCheck = () => (
    <Check size={11} strokeWidth={2.5} className="absolute left-2 text-primary" aria-hidden="true" />
);
