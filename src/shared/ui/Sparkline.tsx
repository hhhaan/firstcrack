const resolveColor = (color: string): string => {
    if (!color.startsWith('var(')) return color;
    const name = color.slice(4, -1).trim();
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#171717';
};

interface SparklineProps {
    data: { bt: number }[];
    color: string;
    width?: number;
    height?: number;
}

export const Sparkline = ({ data, color, width = 200, height = 44 }: SparklineProps) => {
    const bts = data.map((d) => d.bt);
    const min = Math.min(...bts);
    const max = Math.max(...bts);
    const range = max - min || 1;
    const pts = bts
        .map((v, i) => `${(i / (bts.length - 1)) * width},${height - ((v - min) / range) * height}`)
        .join(' ');
    return (
        <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="w-full h-11">
            <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" />
        </svg>
    );
};

export { resolveColor };
