import { useEffect, useRef } from 'react';

interface MonthlyBatchesChartProps {
    data: { month: string; batches: number }[];
}

export const MonthlyBatchesChart = ({ data }: MonthlyBatchesChartProps) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const tooltipRef = useRef<HTMLDivElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    const draw = (canvas: HTMLCanvasElement) => {
        const dpr = window.devicePixelRatio || 1;
        const W = canvas.offsetWidth;
        const H = canvas.offsetHeight;
        if (!W || !H) return;
        canvas.width = W * dpr;
        canvas.height = H * dpr;
        canvas.style.width = `${W}px`;
        canvas.style.height = `${H}px`;

        // biome-ignore lint/style/noNonNullAssertion: error already checked above
        const ctx = canvas.getContext('2d')!;
        ctx.scale(dpr, dpr);

        const cs = getComputedStyle(document.documentElement);
        const colorPrimary = cs.getPropertyValue('--color-primary').trim() || '#171717';
        const colorMuted = cs.getPropertyValue('--color-muted').trim() || '#9ca3af';

        const maxVal = Math.max(...data.map((d) => d.batches), 1);
        const padSide = 18;
        const padT = 8;
        const padB = 28;
        const plotW = W - padSide * 2;
        const plotH = H - padT - padB;
        const barW = Math.min(20, (plotW / data.length) * 0.5);
        const gap = plotW / data.length;

        ctx.strokeStyle = 'rgba(0,0,0,0.05)';
        ctx.lineWidth = 1;
        for (let i = 0; i <= 3; i++) {
            const y = padT + plotH - (i / 3) * plotH;
            ctx.beginPath();
            ctx.moveTo(padSide, y);
            ctx.lineTo(padSide + plotW, y);
            ctx.stroke();
            ctx.fillStyle = colorMuted;
            ctx.font = '11px sans-serif';
            ctx.textAlign = 'right';
            ctx.fillText(String(Math.round((i / 3) * maxVal)), padSide - 4, y + 4);
        }

        data.forEach((d, i) => {
            if (d.batches === 0) return;
            const x = padSide + gap * i + gap / 2 - barW / 2;
            const barH = (d.batches / maxVal) * plotH;
            const y = padT + plotH - barH;
            const r = 4;

            ctx.fillStyle = colorPrimary;
            ctx.beginPath();
            ctx.moveTo(x + r, y);
            ctx.lineTo(x + barW - r, y);
            ctx.quadraticCurveTo(x + barW, y, x + barW, y + r);
            ctx.lineTo(x + barW, y + barH);
            ctx.lineTo(x, y + barH);
            ctx.lineTo(x, y + r);
            ctx.quadraticCurveTo(x, y, x + r, y);
            ctx.closePath();
            ctx.fill();

            ctx.fillStyle = colorMuted;
            ctx.font = '12px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(d.month, padSide + gap * i + gap / 2, H - 6);
        });
    };

    // biome-ignore lint/correctness/useExhaustiveDependencies: intentional dependency array
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        draw(canvas);
        const obs = new ResizeObserver(() => {
            if (canvas) draw(canvas);
        });
        // biome-ignore lint/style/noNonNullAssertion: error already checked above
        obs.observe(canvas.parentElement!);
        return () => obs.disconnect();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [data]);

    const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
        const canvas = canvasRef.current;
        const tt = tooltipRef.current;
        if (!canvas || !tt) return;

        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const W = canvas.offsetWidth;
        const padSide = 18;
        const plotW = W - padSide * 2;
        const gap = plotW / data.length;

        const idx = Math.floor((mx - padSide) / gap);
        if (idx < 0 || idx >= data.length) {
            tt.style.display = 'none';
            return;
        }

        tt.textContent = `${data[idx].month}: ${data[idx].batches} batches`;
        tt.style.display = 'block';
        tt.style.left = `${e.clientX - rect.left + 10}px`;
        tt.style.top = `${e.clientY - rect.top - 30}px`;
    };

    return (
        <div ref={containerRef} className="relative w-full h-full flex items-center justify-center">
            <canvas
                ref={canvasRef}
                className="block w-full h-full"
                onMouseMove={handleMouseMove}
                onMouseLeave={() => {
                    if (tooltipRef.current) tooltipRef.current.style.display = 'none';
                }}
            />
            <div
                ref={tooltipRef}
                className="absolute pointer-events-none bg-white rounded-[10px] px-3 py-1.5 text-[13px] whitespace-nowrap z-10"
                style={{
                    display: 'none',
                    boxShadow: 'rgba(0,0,0,0.4) 0px 0px 1px, rgba(0,0,0,0.04) 0px 4px 4px',
                }}
            />
        </div>
    );
};
