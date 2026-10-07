import { getResolvedChartColors } from '@features/active-roast/lib/chart-config';
import { canvasCurveTokens, resolveCurveStyles } from '@features/active-roast/lib/curve-style';
import type { TemperatureUnit } from '@features/active-roast/model/settings';
import { getRoastSettings } from '@features/active-roast/model/settings';
import type { HistoryPdfLegendItem } from '@features/export-history-pdf';

export const historyPdfLegend = ({
    unit,
    hasTarget,
    hasControls,
    t,
}: {
    unit: TemperatureUnit;
    hasTarget: boolean;
    hasControls: boolean;
    t: (key: string) => string;
}): HistoryPdfLegendItem[] => {
    const colors = getResolvedChartColors(true);
    const curves = resolveCurveStyles(getRoastSettings().curveStyles, canvasCurveTokens(colors));
    return [
        { color: curves.bt.current.color, label: `BT (°${unit})`, lineType: curves.bt.current.type },
        { color: curves.et.current.color, label: `ET (°${unit})`, lineType: curves.et.current.type },
        { color: curves.ror.current.color, label: `RoR (°${unit}/min)`, lineType: curves.ror.current.type },
        ...(hasTarget
            ? [
                  {
                      color: curves.bt.background.color,
                      label: t('settings.tabs.roast.showTargetCurve'),
                      lineType: curves.bt.background.type,
                      opacity: curves.bt.background.opacity,
                  },
              ]
            : []),
        ...(hasControls
            ? [
                  { color: curves.drum.current.color, label: 'Drum', lineType: curves.drum.current.type },
                  { color: curves.heat.current.color, label: 'Heat', lineType: curves.heat.current.type },
                  { color: curves.fan.current.color, label: 'Fan', lineType: curves.fan.current.type },
              ]
            : []),
    ];
};
