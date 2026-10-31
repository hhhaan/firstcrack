import { Document, Font, Image, Line, Page, StyleSheet, Svg, Text, View } from '@react-pdf/renderer';
import type { ComposeHistoryPdfInput } from '../lib/types';

Font.register({
    family: 'SUIT PDF',
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
        padding: 44,
        height: 841.89,
        minHeight: 841.89,
        fontFamily: ['SUIT PDF', 'Noto PDF'],
        color: '#262626',
    },
    header: { marginBottom: 30 },
    title: { fontSize: 19, fontWeight: 600, lineHeight: 1.35, maxLines: 3, textOverflow: 'ellipsis' },
    date: { marginTop: 8, fontSize: 9, color: '#737373' },
    chart: { width: 507.28, height: 520, objectFit: 'contain' },
    legend: { marginTop: 18, flexDirection: 'row', justifyContent: 'center', flexWrap: 'wrap', gap: 18 },
    legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    legendText: { fontSize: 9, color: '#525252' },
});

export const HistoryPdfDocument = ({ title, date, chartDataUrl, legend }: ComposeHistoryPdfInput) => (
    <Document title={title} author="First Crack">
        <Page size="A4" orientation="portrait" style={styles.page} wrap={false}>
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
