import { useTranslation } from 'react-i18next';
import { formatPctValue } from '../lib/format';

type MarginSliderProps = {
    id: string;
    label: string;
    value: number;
    min?: number;
    max?: number;
    step?: number;
    onChange: (value: number) => void;
};

const presets = [20, 30, 40, 50, 60];

const thumbCls = [
    'appearance-none bg-transparent cursor-pointer',
    '[&::-webkit-slider-runnable-track]:h-2.5 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-transparent',
    '[&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:h-5',
    '[&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-main-bg',
    '[&::-webkit-slider-thumb]:border [&::-webkit-slider-thumb]:border-border [&::-webkit-slider-thumb]:shadow-ring',
    '[&::-webkit-slider-thumb]:-mt-[5px]',
    '[&::-moz-range-track]:h-2.5 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-transparent',
    '[&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:h-5 [&::-moz-range-thumb]:rounded-full',
    '[&::-moz-range-thumb]:bg-main-bg [&::-moz-range-thumb]:border [&::-moz-range-thumb]:border-border',
    '[&::-moz-range-progress]:h-2.5 [&::-moz-range-progress]:rounded-full [&::-moz-range-progress]:bg-primary',
].join(' ');

export const MarginSlider = ({ id, label, value, min = 0, max = 80, step = 0.01, onChange }: MarginSliderProps) => {
    const { i18n } = useTranslation();
    const lang = i18n.language;
    const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;

    const handleChange = (raw: string) => {
        const next = parseFloat(raw);
        if (!Number.isFinite(next)) return;
        onChange(next);
    };

    return (
        <div>
            <div className="flex items-center justify-between mb-2">
                <label className="text-[11px] font-medium uppercase tracking-[0.5px] text-muted" htmlFor={id}>
                    {label}
                </label>
                <span className="text-base font-semibold text-primary tabular-nums">
                    {formatPctValue(value, lang) || '0'}%
                </span>
            </div>

            <div className="relative h-8 flex items-center">
                <div
                    className="absolute inset-x-0 h-2.5 rounded-full bg-surface dark:bg-surface-elevated pointer-events-none overflow-hidden"
                    aria-hidden
                >
                    <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
                </div>
                <input
                    id={id}
                    type="range"
                    min={min}
                    max={max}
                    step={step}
                    value={value}
                    onChange={(e) => handleChange(e.target.value)}
                    className={`relative z-10 w-full h-8 ${thumbCls}`}
                    aria-valuemin={min}
                    aria-valuemax={max}
                    aria-valuenow={value}
                />
            </div>

            <div className="flex justify-between text-[11px] text-muted mt-0.5 tabular-nums">
                <span>{min}%</span>
                <span>{max}%</span>
            </div>

            <div className="flex items-center gap-1.5 mt-3">
                {presets.map((p) => (
                    <button
                        key={p}
                        type="button"
                        onClick={() => onChange(p)}
                        className={`px-2.5 py-1 rounded-full text-[11px] font-medium tabular-nums cursor-pointer transition-colors border-none ${
                            Math.abs(value - p) < 0.5
                                ? 'bg-action text-on-action'
                                : 'bg-surface dark:bg-surface-elevated text-muted hover:text-secondary'
                        }`}
                    >
                        {p}%
                    </button>
                ))}
            </div>
        </div>
    );
};
