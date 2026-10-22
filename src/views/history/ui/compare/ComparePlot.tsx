import { buildCompareChartOption, type CompareChartSeries } from '@features/active-roast/lib/chart-option';
import { type TemperatureUnit, useRoastSettings } from '@features/active-roast/model/settings';
import { useThemeStore } from '@shared/store/theme';
import * as echarts from 'echarts';
import { useEffect, useMemo, useRef } from 'react';

interface ComparePlotProps {
    series: CompareChartSeries[];
    channelKeys: string[];
    xView: { start: number; end: number };
    temperatureUnit: TemperatureUnit;
    focusedSessionId: string | null;
    rightMargin: number;
    label: string;
    className: string;
}

export const ComparePlot = ({
    series,
    channelKeys,
    xView,
    temperatureUnit,
    focusedSessionId,
    rightMargin,
    label,
    className,
}: ComparePlotProps) => {
    const elRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<echarts.ECharts | null>(null);
    const renderedFingerprintRef = useRef<string | null>(null);
    const theme = useThemeStore((s) => s.resolvedTheme);
    const { curveStyles } = useRoastSettings();
    // Query arrays change identity on render; cursor movement must not rebuild the plots.
    const dataFingerprint = useMemo(() => JSON.stringify(series), [series]);
    const fingerprint = useMemo(
        () =>
            `${dataFingerprint}|${JSON.stringify([channelKeys, xView, temperatureUnit, focusedSessionId, rightMargin, theme, curveStyles])}`,
        [dataFingerprint, channelKeys, xView, temperatureUnit, focusedSessionId, rightMargin, theme, curveStyles],
    );

    useEffect(() => {
        const el = elRef.current;
        if (!el) return;
        const chart = echarts.init(el, undefined, { renderer: 'canvas' });
        chartRef.current = chart;
        renderedFingerprintRef.current = null;
        const observer = new ResizeObserver(() => chart.resize());
        observer.observe(el);
        return () => {
            observer.disconnect();
            chart.dispose();
            chartRef.current = null;
        };
    }, []);

    useEffect(() => {
        const chart = chartRef.current;
        if (!chart || renderedFingerprintRef.current === fingerprint) return;
        const option = buildCompareChartOption(series, {
            xView,
            temperatureUnit,
            channelKeys,
            focusedSessionId,
            rightMargin,
            curveStyles,
        });
        // The persistent value table replaces the floating tooltip.
        option.tooltip = { show: false };
        for (const axes of [option.xAxis, option.yAxis]) {
            for (const axis of Array.isArray(axes) ? axes : []) axis.axisPointer = { show: false };
        }
        chart.setOption(option, { notMerge: true });
        renderedFingerprintRef.current = fingerprint;
    }, [series, channelKeys, xView, temperatureUnit, focusedSessionId, rightMargin, curveStyles, fingerprint]);

    return <div ref={elRef} role="region" aria-label={label} className={className} />;
};
