import { Document, Font, Image, Line, Page, StyleSheet, Svg, Text, View } from '@react-pdf/renderer';
import { roastPdfLayout } from '@shared/lib/roast-pdf-layout';
import type { ComposeHistoryPdfInput } from '../lib/types';

Font.register({
    family: roastPdfLayout.fontFamily,
    fonts: [
        { src: `${import.meta.env.BASE_URL}fonts/SUIT-Regular.ttf`, fontWeight: 400 },
        { src: `${import.meta.env.BASE_URL}fonts/SUIT-SemiBold.ttf`, fontWeight: 600 },
    ],
});

Font.register({
    family: 'Noto PDF',
    src: `${import.meta.env.BASE_URL}fonts/NotoSansJP-Regular.woff`,
});

const styles = StyleSheet.create({
    page: {
        padding: roastPdfLayout.margin,
        height: roastPdfLayout.pageHeight,
        minHeight: roastPdfLayout.pageHeight,
        fontFamily: [roastPdfLayout.fontFamily, 'Noto PDF'],
        backgroundColor: '#ffffff',
        color: '#262626',
    },
    header: { marginBottom: 16.8 },
    title: { fontSize: 19, fontWeight: 600, lineHeight: 1.35, maxLines: 3, textOverflow: 'ellipsis' },
    date: { marginTop: 6, fontSize: 9, color: '#737373' },
    chart: { width: roastPdfLayout.chartWidth, height: roastPdfLayout.chartHeight, objectFit: 'contain' },
    legend: { marginTop: 9.6, flexDirection: 'row', justifyContent: 'center', flexWrap: 'wrap', gap: 16.8 },
    legendItem: { flexDirection: 'row', alignItems: 'center', gap: 7.2 },
    legendText: { fontSize: 9, color: '#525252' },
    background: {
        position: 'absolute',
        left: 0,
        top: 0,
        width: roastPdfLayout.pageWidth,
        height: roastPdfLayout.pageHeight,
    },
    watermark: {
        position: 'absolute',
        zIndex: -1,
        left: (roastPdfLayout.pageWidth - 260) / 2,
        top: (roastPdfLayout.pageHeight - 260) / 2,
        width: 260,
        height: 260,
        opacity: 0.05,
    },
});

export const HistoryPdfDocument = ({
    title,
    date,
    chartDataUrl,
    legend,
    logoSrc,
}: ComposeHistoryPdfInput & { logoSrc: string }) => (
    <Document title={title} author="First Crack">
        <Page size="A4" orientation="portrait" style={styles.page} wrap={false}>
            {/* Isolate the background so sibling z-index sorting cannot paint it over the chart. */}
            <View style={styles.background}>
                <Image src={logoSrc} style={styles.watermark} />
            </View>
            <View style={styles.header}>
                <Text style={styles.title}>{title}</Text>
                <Text style={styles.date}>{date}</Text>
            </View>
            <Image src={chartDataUrl} style={styles.chart} />
            <View style={styles.legend}>
                {legend.map((item) => (
                    <View key={item.label} style={styles.legendItem}>
                        <Svg width={20} height={6}>
                            <Line
                                x1={0}
                                y1={3}
                                x2={20}
                                y2={3}
                                stroke={item.color}
                                strokeWidth={1}
                                strokeDasharray={
                                    item.lineType === 'dashed' ? '4 3' : item.lineType === 'dotted' ? '1 2' : undefined
                                }
                            />
                        </Svg>
                        <Text style={styles.legendText}>{item.label}</Text>
                    </View>
                ))}
            </View>
        </Page>
    </Document>
);
