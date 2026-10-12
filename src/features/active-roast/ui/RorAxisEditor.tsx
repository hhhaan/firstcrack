import { Popover, PopoverContent, PopoverTrigger } from '@shared/ui/popover/Popover';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { parseRorAxis } from '../lib/ror-axis';
import { toDisplayRoR } from '../lib/temperature';
import { updateRoastSettings, useRoastSettings } from '../model/settings';

export const RorAxisEditor = () => {
    const { t } = useTranslation();
    const settings = useRoastSettings();
    const [open, setOpen] = useState(false);
    const [values, setValues] = useState(['', '', '']);
    const [error, setError] = useState(false);
    const fields = ['min', 'max', 'interval'] as const;
    return (
        <Popover
            open={open}
            onOpenChange={(next) => {
                setOpen(next);
                setError(false);
                if (next)
                    setValues(
                        [settings.rorYMin, settings.rorYMax, settings.rorGridInterval].map((value) =>
                            String(Number(toDisplayRoR(value, settings.temperatureUnit).toFixed(6))),
                        ),
                    );
            }}
        >
            <PopoverTrigger asChild>
                <button
                    type="button"
                    data-testid="ror-axis-edit"
                    aria-label={t('activeRoast.rorAxis.edit')}
                    title={t('activeRoast.rorAxis.edit')}
                    className="absolute right-0 top-1 z-20 rounded bg-main-bg px-1 py-0.5 text-[10px] text-muted hover:text-primary"
                >
                    RoR
                </button>
            </PopoverTrigger>
            <PopoverContent className="w-60 p-4" align="end">
                <form
                    onSubmit={(event) => {
                        event.preventDefault();
                        const patch = parseRorAxis(values[0], values[1], values[2], settings.temperatureUnit);
                        if (!patch) {
                            setError(true);
                            return;
                        }
                        updateRoastSettings(patch);
                        setOpen(false);
                    }}
                >
                    <p className="mb-3 text-sm text-primary">
                        {t('activeRoast.rorAxis.edit')} (°{settings.temperatureUnit}/min)
                    </p>
                    {fields.map((field, index) => (
                        <label key={field} className="mb-2 block text-xs text-muted">
                            {t(`activeRoast.rorAxis.${field}`)}
                            <input
                                type="number"
                                step="any"
                                required
                                value={values[index]}
                                onChange={(event) =>
                                    setValues((current) =>
                                        current.map((value, i) => (i === index ? event.target.value : value)),
                                    )
                                }
                                className="mt-1 w-full rounded border border-border bg-main-bg p-1 text-primary"
                            />
                        </label>
                    ))}
                    {error && (
                        <p role="alert" className="mb-2 text-xs text-error">
                            {t('activeRoast.rorAxis.invalid')}
                        </p>
                    )}
                    <button type="submit" className="text-xs text-primary">
                        {t('common.save')}
                    </button>
                </form>
            </PopoverContent>
        </Popover>
    );
};
