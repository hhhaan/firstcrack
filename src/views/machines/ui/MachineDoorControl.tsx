const switchCls =
    'relative h-6 w-10 shrink-0 cursor-pointer appearance-none rounded-full bg-primary/15 transition-colors checked:bg-primary before:absolute before:left-1 before:top-1 before:h-4 before:w-4 before:rounded-full before:bg-main-bg before:transition-transform checked:before:translate-x-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

type DoorCardProps = {
    label: string;
    hint: string;
    checked: boolean;
    onChange: (checked: boolean) => void;
};

const DoorCard = ({ label, hint, checked, onChange }: DoorCardProps) => (
    <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg bg-surface px-4 py-3.5 dark:bg-surface-elevated">
        <span className="min-w-0">
            <span className="block text-[13px] font-medium text-primary">{label}</span>
            <span className="mt-0.5 block text-[11px] leading-relaxed text-muted">{hint}</span>
        </span>
        <input
            type="checkbox"
            className={switchCls}
            checked={checked}
            onChange={(event) => onChange(event.target.checked)}
        />
    </label>
);

type Props = {
    discharge: boolean;
    fill: boolean;
    dischargeLabel: string;
    dischargeHint: string;
    fillLabel: string;
    fillHint: string;
    title: string;
    onDischarge: (checked: boolean) => void;
    onFill: (checked: boolean) => void;
};

export const MachineDoorControl = ({
    discharge,
    fill,
    dischargeLabel,
    dischargeHint,
    fillLabel,
    fillHint,
    title,
    onDischarge,
    onFill,
}: Props) => (
    <div className="mb-6">
        <div className="mb-2.5 text-[12px] font-semibold text-secondary">{title}</div>
        <div className="grid grid-cols-2 gap-3.5">
            <DoorCard label={dischargeLabel} hint={dischargeHint} checked={discharge} onChange={onDischarge} />
            <DoorCard label={fillLabel} hint={fillHint} checked={fill} onChange={onFill} />
        </div>
    </div>
);
