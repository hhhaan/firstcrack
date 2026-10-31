import type { ResolvedCurveStyles } from '@features/active-roast/lib/curve-style';
import { roastPdfLayout } from '@shared/lib/roast-pdf-layout';
import type { XAXisComponentOption, YAXisComponentOption } from 'echarts';
import type { TemperatureUnit } from '../../model/settings';
import { applyPrintAxes, applyReportAxes, buildSingleGridLayout, type SingleGridAxesParams } from './axes';
import { lineSeriesBase } from './series';
import type { ControlData } from './types';

type PrintControl = {
    role: 'heater' | 'fan' | 'drum';
    name: string;
    label: string;
    unit: string | undefined;
    data: [number, number | null][];
    command: boolean;
    style: ResolvedCurveStyles['heat']['current'];
};

export const buildPrintControls = (
    params: SingleGridAxesParams & {
        controlData: ControlData;
        curves: ResolvedCurveStyles;
        temperatureUnit: TemperatureUnit;
    },
) => {
    const { controlData: source, curves, xMin, xMax } = params;
    const inRange = (index: number) => source.xs[index] >= xMin && source.xs[index] <= xMax;
    const hasGas = source.heatSet?.some((value, index) => value != null && Number.isFinite(value) && inRange(index));
    const unitFor = (role: 'heater' | 'fan' | 'drum') =>
        source.readUnits?.find((units, index) => inRange(index) && units?.[role])?.[role];
    const channels = [
        {
            role: 'heater' as const,
            name: hasGas ? 'Heat set' : 'Heat',
            label: hasGas ? 'Gas' : 'Heat',
            unit: hasGas ? source.heatSetUnit : unitFor('heater'),
            values: hasGas ? source.heatSet : source.heatPower,
            style: curves.heat.current,
        },
        {
            role: 'fan' as const,
            name: 'Fan',
            label: 'Fan',
            unit: unitFor('fan'),
            values: source.fanSpeed,
            style: curves.fan.current,
        },
        {
            role: 'drum' as const,
            name: 'Drum',
            label: 'Drum',
            unit: unitFor('drum'),
            values: source.drumTemp,
            style: curves.drum.current,
        },
    ].flatMap<PrintControl>((channel) => {
        const data: [number, number | null][] = [];
        source.xs.forEach((time, index) => {
            if (!inRange(index)) return;
            const value = channel.values?.[index];
            data.push([time, value != null && Number.isFinite(value) ? value : null]);
        });
        if (data.some(([, value]) => value != null))
            return [{ ...channel, data, command: channel.name === 'Heat set' }];
        const commands: [number, number][] = [];
        for (const change of [...(source.changes ?? [])].sort((a, b) => a.timeSec - b.timeSec)) {
            const value = change.values[channel.role];
            if (!Number.isFinite(change.timeSec) || change.timeSec > xMax || value == null || !Number.isFinite(value))
                continue;
            const time = Math.max(xMin, change.timeSec);
            if (commands.length && commands[commands.length - 1][0] === time)
                commands[commands.length - 1] = [time, value];
            else commands.push([time, value]);
        }
        if (!commands.length) return [];
        // An acknowledged command holds until the next command; no value is inferred before the first one.
        commands.push([xMax, commands[commands.length - 1][1]]);
        return [
            {
                ...channel,
                name: channel.role === 'heater' ? 'Heat set' : `${channel.name} set`,
                label: channel.role === 'heater' ? 'Gas' : `${channel.label} set`,
                unit: channel.role === 'heater' ? source.heatSetUnit : undefined,
                data: commands,
                command: true,
            },
        ];
    });
    const { grid, xAxis: baseX, yAxis: baseY } = buildSingleGridLayout(params);
    const xAxis: XAXisComponentOption[] = Array.isArray(baseX) ? baseX : [];
    const yAxis: YAXisComponentOption[] = Array.isArray(baseY) ? baseY : [];
    applyReportAxes({ xAxis, yAxis }, params.colors, xMax - xMin, params.temperatureUnit);

    const axisSpace = 32;
    const controlWeights = channels.map((channel) => (channel.role === 'heater' ? 1.5 : 1));
    const rowHeight =
        (roastPdfLayout.chartHeight -
            20 -
            (channels.length + 1) * axisSpace -
            channels.length * roastPdfLayout.plotGap) /
        (4 + controlWeights.reduce((total, weight) => total + weight, 0));
    let controlTop = 20 + rowHeight * 4 + axisSpace + roastPdfLayout.plotGap;
    grid[0] = { ...grid[0], top: 20, height: rowHeight * 4, bottom: undefined };
    channels.forEach((channel, index) => {
        const gridIndex = index + 1;
        grid.push({
            left: params.leftMargin,
            right: params.rightMargin,
            top: controlTop,
            height: rowHeight * controlWeights[index],
        });
        controlTop += rowHeight * controlWeights[index] + axisSpace + roastPdfLayout.plotGap;
        xAxis.push({ ...xAxis[0], gridIndex });
        yAxis.push({
            type: 'value',
            axisLine: { show: false },
            axisTick: { show: false },
            nameTextStyle: params.axisNameStyle,
            gridIndex,
            min: channel.data.reduce((min, [, value]) => (value == null ? min : Math.min(min, value)), 0),
            max: channel.data.every(([, value]) => value == null || value === 0) ? 10 : undefined,
            interval: 10,
            axisLabel: { ...params.axisLabelStyle, formatter: (value: number) => String(value) },
            splitLine: { show: true, lineStyle: { color: params.colors.gridLine } },
        });
    });
    applyPrintAxes(
        { xAxis, yAxis },
        params.temperatureUnit,
        channels.map((channel) => (channel.unit ? `${channel.label} (${channel.unit})` : channel.label)),
    );
    const series = channels.map((channel, index) => ({
        ...lineSeriesBase,
        name: channel.name,
        type: 'line' as const,
        step: channel.command ? ('end' as const) : false,
        xAxisIndex: index + 1,
        yAxisIndex: index + 2,
        data: channel.data,
        lineStyle: { ...channel.style, type: 'solid' as const },
    }));
    return { grid, xAxis, yAxis, series };
};
