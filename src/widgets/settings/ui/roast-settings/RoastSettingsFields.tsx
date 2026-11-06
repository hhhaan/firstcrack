import type { RoastSettings } from '@features/active-roast';
import { updateRoastSettings, useRoastSettings } from '@features/active-roast';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NumericFormat } from 'react-number-format';
import { SettingsCheckRow } from '../SettingsOptionRow';

type BooleanSettingKey = {
    [Key in keyof RoastSettings]: RoastSettings[Key] extends boolean ? Key : never;
}[keyof RoastSettings];

export type RoastCheckOption = {
    key: BooleanSettingKey;
    labelKey: string;
    descKey: string;
};
export const RoastCheckRows = ({ options }: { options: readonly RoastCheckOption[] }) => {
    const { t } = useTranslation();
    const roastSettings = useRoastSettings();
    return options.map(({ key, labelKey, descKey }) => (
        <SettingsCheckRow
            key={key}
            type="checkbox"
            checked={roastSettings[key]}
            label={t(labelKey)}
            description={t(descKey)}
            onChange={() => updateRoastSettings({ [key]: !roastSettings[key] })}
        />
    ));
};
const numberInputWrapCls = 'flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-border bg-main-bg';

export const NumberInput = ({
    id,
    value,
    onChange,
    min,
    max,
    suffix,
    ariaLabel,
    integer = false,
    step = 1,
}: {
    id?: string;
    value: number;
    onChange: (v: number) => void;
    min?: number;
    max?: number;
    suffix?: string;
    ariaLabel?: string;
    integer?: boolean;
    step?: number;
}) => {
    const [local, setLocal] = useState(() => String(value));

    useEffect(() => {
        setLocal(String(value));
    }, [value]);

    const clamp = (n: number) => {
        if (min !== undefined && n < min) return min;
        if (max !== undefined && n > max) return max;
        return n;
    };

    return (
        <div className={numberInputWrapCls}>
            <NumericFormat
                id={id}
                aria-label={ariaLabel}
                value={local}
                valueIsNumericString
                allowNegative
                decimalScale={integer ? 0 : undefined}
                onValueChange={(values) => {
                    setLocal(values.value);
                    if (integer || values.floatValue === undefined) return;
                    onChange(clamp(values.floatValue));
                }}
                onBlur={(event) => {
                    const typed = event.currentTarget.value;
                    if (!integer) {
                        if (typed === '') {
                            const fallback = min ?? 0;
                            setLocal(String(fallback));
                            onChange(fallback);
                        }
                        return;
                    }
                    const parsed = Number(typed);
                    const stepped = Number.isFinite(parsed) ? Math.round(parsed / step) * step : Number.NaN;
                    const next = Number.isFinite(stepped) ? clamp(stepped) : (min ?? value);
                    setLocal(String(next));
                    if (next !== value) onChange(next);
                }}
                className="w-14 bg-transparent text-[13px] font-medium text-[#111827] dark:text-primary text-right outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
            />
            {suffix && <span className="text-[12px] text-[#6B7280] dark:text-muted">{suffix}</span>}
        </div>
    );
};
