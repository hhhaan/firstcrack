import {
    BACKGROUND_CHANNELS,
    CSS_CURVE_TOKENS,
    CURVE_CHANNELS,
    CURVE_LINE_TYPES,
    CURVE_WIDTH_MAX,
    CURVE_WIDTH_MIN,
    type CurveChannel,
    type CurveLineType,
    CurveSwatch,
    HEAT_CURRENT_LINE_TYPE,
    resetCurveStyles,
    updateCurveStyle,
    useCurveStyles,
    useRoastSettings,
} from '@features/active-roast';
import { useThemeStore } from '@shared/store/theme';
import { SurfaceButton } from '@shared/ui/SurfaceButton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@shared/ui/select/Select';
import { RotateCcw } from 'lucide-react';
import { useLayoutEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CurveStyleColorInput } from './CurveStyleColorInput';
import { SettingsSection } from './SettingsSection';

const CHANNEL_LABEL_KEY: Record<CurveChannel, string> = {
    bt: 'curveStyleChannelBt',
    et: 'curveStyleChannelEt',
    ror: 'curveStyleChannelRor',
    etRor: 'curveStyleChannelEtRor',
    heat: 'controlHeat',
    fan: 'controlFan',
    drum: 'controlDrum',
};

/** `<input type="color">` only takes `#rrggbb`; theme tokens are oklch, so read them back through a canvas pixel. */
const readThemeHex = (cssVar: string): string => {
    const value = getComputedStyle(document.documentElement).getPropertyValue(cssVar.slice(4, -1)).trim();
    const ctx = value ? document.createElement('canvas').getContext('2d') : null;
    if (!ctx) return '#000000';
    ctx.fillStyle = value;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
};

const readThemeHexForChannels = (): Record<CurveChannel, string> => {
    const map: Partial<Record<CurveChannel, string>> = {};
    for (const channel of CURVE_CHANNELS) {
        map[channel] = readThemeHex(CSS_CURVE_TOKENS[channel].current);
    }
    return map as Record<CurveChannel, string>;
};

/**
 * `useThemeStore.setTheme` calls `applyThemeToDOM` before updating `resolvedTheme`.
 * Re-read token hex in layout effect so the picker fallback always matches the class on `<html>`.
 */
const useThemeHexForChannels = (resolvedTheme: string) => {
    const [themeHexByChannel, setThemeHexByChannel] = useState(readThemeHexForChannels);
    useLayoutEffect(() => {
        void resolvedTheme;
        setThemeHexByChannel(readThemeHexForChannels());
    }, [resolvedTheme]);
    return themeHexByChannel;
};

const WidthInput = ({ value, label, onCommit }: { value: number; label: string; onCommit: (v: number) => void }) => {
    const [draft, setDraft] = useState<string | null>(null);
    const commit = () => {
        const next = Number(draft);
        if (draft?.trim() && Number.isFinite(next) && next >= CURVE_WIDTH_MIN && next <= CURVE_WIDTH_MAX) {
            onCommit(next);
        }
        setDraft(null);
    };
    return (
        <input
            type="number"
            min={CURVE_WIDTH_MIN}
            max={CURVE_WIDTH_MAX}
            step={0.1}
            value={draft ?? String(value)}
            aria-label={label}
            onChange={(event) => setDraft(event.currentTarget.value)}
            onBlur={commit}
            onKeyDown={(event) => {
                if (event.key === 'Enter') commit();
            }}
            className="h-8 w-14 rounded-md bg-surface px-2 text-right font-mono text-[13px] text-primary shadow-(--shadow-inset) outline-none focus:ring-1 focus:ring-primary/20"
        />
    );
};

const LineTypeSelect = ({
    value,
    label,
    onChange,
}: {
    value: CurveLineType;
    label: string;
    onChange: (v: CurveLineType) => void;
}) => {
    const { t } = useTranslation();
    return (
        <Select
            value={value}
            onValueChange={(next) => {
                const type = CURVE_LINE_TYPES.find((option) => option === next);
                if (type) onChange(type);
            }}
        >
            <SelectTrigger className="w-24" aria-label={label}>
                <SelectValue />
            </SelectTrigger>
            <SelectContent>
                {CURVE_LINE_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                        {t(`settings.tabs.roast.curveLineType.${type}`)}
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    );
};

export const CurveStyleSection = () => {
    const { t } = useTranslation();
    const tk = (key: string) => t(`settings.tabs.roast.${key}`);
    const { curveStyles } = useRoastSettings();
    const curves = useCurveStyles();
    const resolvedTheme = useThemeStore((state) => state.resolvedTheme);
    const themeHexByChannel = useThemeHexForChannels(resolvedTheme);
    const headCls = 'px-2 pb-2 text-left text-[11px] font-medium text-muted';

    return (
        <SettingsSection>
            <SettingsSection.Header title={tk('curveStyles')} description={tk('curveStylesDescription')} />
            <SettingsSection.Body className="grid gap-3">
                <div className="overflow-x-auto">
                    <table className="w-full min-w-[560px] border-collapse text-[13px]">
                        <thead>
                            <tr>
                                <th className={headCls} rowSpan={2}>
                                    {tk('curveStyleChannel')}
                                </th>
                                <th className={headCls} rowSpan={2}>
                                    {tk('curveStyleColor')}
                                </th>
                                <th className={headCls} colSpan={2}>
                                    {tk('curveStyleCurrent')}
                                </th>
                                <th className={headCls} colSpan={2}>
                                    {tk('curveStyleBackground')}
                                </th>
                            </tr>
                            <tr>
                                <th className={headCls}>{tk('curveStyleWidth')}</th>
                                <th className={headCls}>{tk('curveStyleLine')}</th>
                                <th className={headCls}>{tk('curveStyleWidth')}</th>
                                <th className={headCls}>{tk('curveStyleLine')}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {CURVE_CHANNELS.map((channel) => {
                                const style = curveStyles[channel];
                                const name = tk(CHANNEL_LABEL_KEY[channel]);
                                const hasBackground = BACKGROUND_CHANNELS.includes(channel);
                                const part = (key: string) => `${name} ${tk(key)}`;
                                const heatCurrentLocked = channel === 'heat';
                                return (
                                    <tr key={channel} className="border-t border-border-subtle">
                                        <th scope="row" className="px-2 py-2 text-left font-medium text-primary">
                                            <span className="flex items-center gap-2">
                                                <CurveSwatch style={curves[channel].current} />
                                                {name}
                                            </span>
                                        </th>
                                        <td className="px-2 py-2">
                                            <span className="flex items-center gap-1">
                                                <CurveStyleColorInput
                                                    value={style.color}
                                                    themeFallback={themeHexByChannel[channel]}
                                                    label={part('curveStyleColor')}
                                                    onCommit={(color) => updateCurveStyle(channel, { color })}
                                                />
                                                {style.color && (
                                                    <button
                                                        type="button"
                                                        title={tk('curveStyleThemeColor')}
                                                        aria-label={part('curveStyleThemeColor')}
                                                        onClick={() => updateCurveStyle(channel, { color: null })}
                                                        className="rounded p-1 text-muted hover:text-primary cursor-pointer"
                                                    >
                                                        <RotateCcw size={13} strokeWidth={2} />
                                                    </button>
                                                )}
                                            </span>
                                        </td>
                                        <td className="px-2 py-2">
                                            <WidthInput
                                                value={style.width}
                                                label={part('curveStyleCurrentWidth')}
                                                onCommit={(width) => updateCurveStyle(channel, { width })}
                                            />
                                        </td>
                                        <td className="px-2 py-2">
                                            {heatCurrentLocked ? (
                                                <span className="inline-flex h-8 items-center text-[12px] text-muted">
                                                    {t(`settings.tabs.roast.curveLineType.${HEAT_CURRENT_LINE_TYPE}`)}
                                                </span>
                                            ) : (
                                                <LineTypeSelect
                                                    value={style.lineType}
                                                    label={part('curveStyleCurrentLine')}
                                                    onChange={(lineType) => updateCurveStyle(channel, { lineType })}
                                                />
                                            )}
                                        </td>
                                        {hasBackground ? (
                                            <>
                                                <td className="px-2 py-2">
                                                    <WidthInput
                                                        value={style.backgroundWidth}
                                                        label={part('curveStyleBackgroundWidth')}
                                                        onCommit={(backgroundWidth) =>
                                                            updateCurveStyle(channel, { backgroundWidth })
                                                        }
                                                    />
                                                </td>
                                                <td className="px-2 py-2">
                                                    <LineTypeSelect
                                                        value={style.backgroundLineType}
                                                        label={part('curveStyleBackgroundLine')}
                                                        onChange={(backgroundLineType) =>
                                                            updateCurveStyle(channel, { backgroundLineType })
                                                        }
                                                    />
                                                </td>
                                            </>
                                        ) : (
                                            <td colSpan={2} className="px-2 py-2 text-[12px] text-muted">
                                                {tk('curveStyleNoBackground')}
                                            </td>
                                        )}
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
                <SurfaceButton
                    className="justify-self-start"
                    icon={<RotateCcw size={14} strokeWidth={2} />}
                    onClick={resetCurveStyles}
                >
                    {tk('curveStylesReset')}
                </SurfaceButton>
            </SettingsSection.Body>
        </SettingsSection>
    );
};
