import { getResolvedChartColors } from '@features/active-roast/lib/chart-config';
import { canvasCurveTokens, resolveCurveStyles } from '@features/active-roast/lib/curve-style';
import type { TemperatureUnit } from '@features/active-roast/model/settings';
import { getRoastSettings } from '@features/active-roast/model/settings';
import type { HistoryPdfLegendItem } from '@features/export-history-pdf';

export const historyPdfLegend = (unit: TemperatureUnit, hasEtRor = false): HistoryPdfLegendItem[] => {
    const colors = getResolvedChartColors(true);
    const curves = resolveCurveStyles(getRoastSettings().curveStyles, canvasCurveTokens(colors));
    return [
        { color: curves.bt.current.color, label: `BT (°${unit})`, lineType: curves.bt.current.type },
        { color: curves.et.current.color, label: `ET (°${unit})`, lineType: curves.et.current.type },
        { color: curves.ror.current.color, label: `BT RoR (°${unit}/min)`, lineType: curves.ror.current.type },
        ...(hasEtRor
            ? [
                  {
                      color: curves.etRor.current.color,
                      label: `ET RoR (°${unit}/min)`,
                      lineType: 'dashed' as const,
                  },
              ]
            : []),
    ];
};
