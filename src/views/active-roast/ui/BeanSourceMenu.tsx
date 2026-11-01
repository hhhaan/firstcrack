import { Popover, PopoverContent, PopoverTrigger } from '@shared/ui/popover/Popover';
import { Check, ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

const itemCls =
    'relative flex w-full min-w-0 cursor-pointer items-center overflow-hidden rounded-md py-1.5 pr-2.5 pl-7 text-left text-[13px] tracking-[0.14px] text-secondary hover:bg-surface hover:text-primary';
const checkedCls = 'font-medium text-primary';

type BeanSourceItem = { value: string; label: string };
export type BeanSourceGroup = { label: string; items: BeanSourceItem[] };

export const BeanSourceMenu = ({
    value,
    groups,
    disabled = false,
    onSelect,
}: {
    value: string;
    groups: BeanSourceGroup[];
    disabled?: boolean;
    onSelect: (value: string) => void;
}) => {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const choose = (next: string) => {
        setOpen(false);
        onSelect(next);
    };
    const setMenuOpen = (next: boolean) => {
        if (!disabled) setOpen(next);
    };

    return (
        <Popover open={disabled ? false : open} onOpenChange={setMenuOpen}>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    aria-label={t('activeRoast.summary.bean')}
                    data-value={value}
                    disabled={disabled}
                    className="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded border-none bg-transparent p-0 text-muted outline-none focus-visible:outline-2 focus-visible:outline-(--color-primary) disabled:cursor-default"
                >
                    <ChevronDown size={18} />
                </button>
            </PopoverTrigger>
            <PopoverContent
                align="start"
                sideOffset={6}
                className="w-max min-w-72 max-w-[32rem] overflow-hidden rounded-lg border border-black/15 bg-main-bg p-1 shadow-[0_2px_10px_rgba(0,0,0,0.06)]"
            >
                <div className="max-h-72 overflow-x-hidden overflow-y-auto">
                    <SourceRow
                        label={t('activeRoast.header.noBeanSelected')}
                        checked={value === ''}
                        onChoose={() => choose('')}
                    />
                    {groups.map((group) => (
                        <div key={group.label}>
                            <div className="px-2 pt-2 pb-0.5 text-[11px] tracking-[0.04em] text-muted">
                                {group.label}
                            </div>
                            {group.items.map((item, index) => (
                                <SourceRow
                                    key={`${group.label}:${item.value}:${index}`}
                                    label={item.label}
                                    checked={item.value !== '' && item.value === value}
                                    onChoose={() => choose(item.value)}
                                />
                            ))}
                        </div>
                    ))}
                </div>
            </PopoverContent>
        </Popover>
    );
};

const SourceRow = ({ label, checked, onChoose }: { label: string; checked: boolean; onChoose: () => void }) => (
    <button
        type="button"
        className={checked ? `${itemCls} ${checkedCls}` : itemCls}
        aria-current={checked ? 'true' : undefined}
        onClick={onChoose}
    >
        {checked && <MenuCheck />}
        <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
);

const MenuCheck = () => (
    <Check size={11} strokeWidth={2.5} className="absolute left-2 text-primary" aria-hidden="true" />
);
