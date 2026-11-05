import { roastPdfLayout } from '@shared/lib/roast-pdf-layout';
import * as echarts from 'echarts';
import type { TemperatureUnit } from '../../model/settings';
import { getResolvedChartColors } from '../chart-config';
import { type CurveStyles, canvasCurveTokens, resolveCurveStyles } from '../curve-style';

export type RoastPdfChart = {
    chartDataUrl: string;
    legend: { color: string; label: string; lineType: 'solid' }[];
};

export const captureRoastPdfChart = async ({
    makeOption,
    curveStyles,
    unit,
    hasEtRor,
}: {
    makeOption: (colors: ReturnType<typeof getResolvedChartColors>) => echarts.EChartsOption;
    curveStyles: CurveStyles;
    unit: TemperatureUnit;
    hasEtRor: boolean;
}): Promise<RoastPdfChart> => {
    await document.fonts.load(`400 ${roastPdfLayout.tickFontSize}px ${roastPdfLayout.fontFamily}`);
    const pixelRatio = 200 / 72;
    const width = Math.round(roastPdfLayout.chartWidth * pixelRatio) / pixelRatio;
    const height = Math.round(roastPdfLayout.chartHeight * pixelRatio) / pixelRatio;
    const colors = getResolvedChartColors(true);
    const curves = resolveCurveStyles(curveStyles, canvasCurveTokens(colors));
    const el = document.createElement('div');
    el.className = 'font-inconsolata';
    el.style.cssText = `position:absolute;left:-9999px;top:0;width:${width}px;height:${height}px`;
    document.body.appendChild(el);
    try {
        const chart = echarts.init(el, undefined, { renderer: 'canvas', devicePixelRatio: pixelRatio });
        try {
            chart.setOption(makeOption(colors), true);
            return {
                chartDataUrl: chart.getDataURL({ type: 'png', backgroundColor: 'rgba(0,0,0,0)', pixelRatio }),
                legend: [
                    { color: curves.bt.current.color, label: `BT (°${unit})`, lineType: 'solid' },
                    { color: curves.et.current.color, label: `ET (°${unit})`, lineType: 'solid' },
                    { color: curves.ror.current.color, label: `BT RoR (°${unit}/min)`, lineType: 'solid' },
                    ...(hasEtRor
                        ? [
                              {
                                  color: curves.etRor.current.color,
                                  label: `ET RoR (°${unit}/min)`,
                                  lineType: 'solid' as const,
                              },
                          ]
                        : []),
                ],
            };
        } finally {
            chart.dispose();
        }
    } finally {
        el.remove();
    }
};
