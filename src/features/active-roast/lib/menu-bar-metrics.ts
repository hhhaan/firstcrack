/** macOS status item images are shown at 18pt; baselines fit both rows without shrinking the type. */
export const MENU_BAR_HEIGHT = 18;
const LABEL_PX = 8;
const VALUE_PX = 13;
const PAD_X = 2;
const LABEL_BASELINE = 6;
const VALUE_BASELINE = 18;
const COLUMN_GAP = 8;
const SCALE = 2;

export type MenuBarReading = {
    et: string;
    bt: string;
    ror: string;
    time: string;
};

export type MenuBarGlyph = {
    text: string;
    x: number;
    y: number;
    kind: 'label' | 'value';
};

export type MenuBarLayout = {
    width: number;
    height: number;
    glyphs: MenuBarGlyph[];
};

type Measure = (text: string) => number;

const columnsOf = (reading: MenuBarReading): { label: string; value: string }[] => [
    { label: 'ET', value: reading.et },
    { label: 'BT', value: reading.bt },
    { label: 'RoR', value: reading.ror },
    { label: 'Time', value: reading.time },
];

/** Small name over a larger number. Each column shares one left edge. */
export const layoutMenuBarMetrics = (
    measureLabel: Measure,
    measureValue: Measure,
    reading: MenuBarReading,
): MenuBarLayout => {
    const columns = columnsOf(reading).map((cell) => ({
        ...cell,
        width: Math.ceil(Math.max(measureLabel(cell.label), measureValue(cell.value))),
    }));
    const width =
        PAD_X * 2 + columns.reduce((sum, column) => sum + column.width, 0) + COLUMN_GAP * (columns.length - 1);

    const glyphs: MenuBarGlyph[] = [];
    let x = PAD_X;
    for (const column of columns) {
        glyphs.push({ text: column.label, x, y: LABEL_BASELINE, kind: 'label' });
        glyphs.push({ text: column.value, x, y: VALUE_BASELINE, kind: 'value' });
        x += column.width + COLUMN_GAP;
    }

    return { width, height: MENU_BAR_HEIGHT, glyphs };
};

/** Canvas does not resolve the CSS keyword `-apple-system`. These are the Mac system UI faces. */
const SYSTEM_FAMILY = '".AppleSystemUIFont", "SF Pro Text", "SF Pro", system-ui';

const font = (weight: number, px: number) => `${weight} ${px}px ${SYSTEM_FAMILY}`;

/** Black text on transparent. The status item treats it as a template, so light and dark menu bars both tint it. */
export const drawMenuBarMetrics = (
    reading: MenuBarReading,
): { rgba: Uint8Array; width: number; height: number } | null => {
    if (typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const labelFont = font(500, LABEL_PX);
    const valueFont = font(500, VALUE_PX);
    const measureLabel = (text: string) => {
        ctx.font = labelFont;
        return ctx.measureText(text).width;
    };
    const measureValue = (text: string) => {
        ctx.font = valueFont;
        return ctx.measureText(text).width;
    };
    const layout = layoutMenuBarMetrics(measureLabel, measureValue, reading);
    canvas.width = Math.ceil(layout.width * SCALE);
    canvas.height = MENU_BAR_HEIGHT * SCALE;
    ctx.scale(SCALE, SCALE);
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#000000';
    for (const glyph of layout.glyphs) {
        ctx.font = glyph.kind === 'label' ? labelFont : valueFont;
        ctx.fillText(glyph.text, glyph.x, glyph.y);
    }

    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return { rgba: new Uint8Array(data), width: canvas.width, height: canvas.height };
};
