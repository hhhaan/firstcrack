import { Document, Font, Page, StyleSheet, Text, View } from '@react-pdf/renderer';

Font.register({
    family: 'NotoSansKR',
    src: '/fonts/NotoSansKR-ko.ttf',
});

const S = StyleSheet.create({
    page: {
        fontFamily: 'NotoSansKR',
        fontSize: 9,
        color: '#000000',
        paddingTop: 53,
        paddingBottom: 53,
        paddingLeft: 53,
        paddingRight: 53,
        lineHeight: 1.4,
    },
    docNumber: {
        textAlign: 'right',
        fontSize: 8,
        marginBottom: 11,
    },
    titleBlock: {
        textAlign: 'center',
        marginBottom: 17,
    },
    titleMain: {
        fontSize: 14,
        fontWeight: 'bold',
        letterSpacing: 3,
        marginBottom: 3,
    },
    titleSub: {
        fontSize: 10,
    },
    sectionLabel: {
        fontSize: 9,
        fontWeight: 'bold',
        marginBottom: 3,
    },
    table: {
        width: '100%',
        marginBottom: 14,
        borderTop: '1pt solid #000000',
        borderLeft: '1pt solid #000000',
    },
    row: {
        flexDirection: 'row',
    },
    cell: {
        borderBottom: '1pt solid #000000',
        borderRight: '1pt solid #000000',
        padding: '4pt 6pt',
        textAlign: 'center',
    },
    cellLeft: {
        borderBottom: '1pt solid #000000',
        borderRight: '1pt solid #000000',
        padding: '4pt 6pt',
        textAlign: 'left',
    },
    cellRight: {
        borderBottom: '1pt solid #000000',
        borderRight: '1pt solid #000000',
        padding: '4pt 6pt',
        textAlign: 'right',
    },
    headerCell: {
        borderBottom: '1pt solid #000000',
        borderRight: '1pt solid #000000',
        padding: '5pt 6pt',
        backgroundColor: '#f3f4f6',
        fontWeight: 'bold',
        textAlign: 'center',
    },
    footer: {
        fontSize: 8,
        textAlign: 'center',
        borderTop: '1pt solid #000000',
        paddingTop: 6,
        color: '#4b5563',
        marginTop: 'auto',
    },
});

export type MonthlyReportPdfData = {
    year: number;
    month: number;
    businessName: string;
    ownerName: string;
    bizNumber: string;
    writer: string;
    reviewer: string;
    representative: string;
    sessions: {
        date: string;
        beanLot: string;
        inputKg: number;
        outputKg: number;
        lossRate: number;
        worker: string;
        note?: string;
    }[];
    today: string;
};

const COL = {
    no: 32,
    date: 60,
    bean: 100,
    input: 44,
    output: 44,
    loss: 44,
    lossRate: 44,
    worker: 50,
    note: 56,
};

type CellProps = { width?: number; flex?: number; bg?: string; bold?: boolean; align?: 'left' | 'center' | 'right'; children: React.ReactNode };

const Cell = ({ width, flex, bg, bold, align = 'center', children }: CellProps) => (
    <View
        style={{
            ...(flex !== undefined ? { flex } : { width }),
            borderBottom: '1pt solid #000000',
            borderRight: '1pt solid #000000',
            padding: '4pt 4pt',
            backgroundColor: bg,
            justifyContent: 'center',
        }}
    >
        <Text style={{ fontWeight: bold ? 'bold' : 'normal', textAlign: align, fontSize: 8 }}>{children}</Text>
    </View>
);

export const MonthlyReportPdfDocument = ({ data }: { data: MonthlyReportPdfData }) => {
    const { year, month, businessName, ownerName, bizNumber, writer, reviewer, representative, sessions, today } = data;

    const totalInput = sessions.reduce((s, r) => s + r.inputKg, 0);
    const totalOutput = sessions.reduce((s, r) => s + r.outputKg, 0);
    const totalLoss = totalInput - totalOutput;
    const avgLossRate = totalInput > 0 ? (totalLoss / totalInput) * 100 : 0;
    const lastDay = new Date(year, month, 0).getDate();

    return (
        <Document>
            <Page size="A4" style={S.page}>
                {/* 문서번호 */}
                <Text style={S.docNumber}>
                    문서번호: {year}-{String(month).padStart(2, '0')}-PROD
                </Text>

                {/* 제목 */}
                <View style={S.titleBlock}>
                    <Text style={S.titleMain}>커피원두 가공생산 월간보고서</Text>
                    <Text style={S.titleSub}>
                        {year}년 {month}월분
                    </Text>
                </View>

                {/* 업체 정보 */}
                <View style={S.table}>
                    <View style={S.row}>
                        <View style={{ ...S.headerCell, width: '25%' }}>
                            <Text>상호</Text>
                        </View>
                        <View style={{ ...S.cell, width: '25%' }}>
                            <Text>{businessName}</Text>
                        </View>
                        <View style={{ ...S.headerCell, width: '25%' }}>
                            <Text>대표자</Text>
                        </View>
                        <View style={{ ...S.cell, width: '25%' }}>
                            <Text>{ownerName}</Text>
                        </View>
                    </View>
                    <View style={S.row}>
                        <View style={{ ...S.headerCell, width: '25%' }}>
                            <Text>사업자등록번호</Text>
                        </View>
                        <View style={{ ...S.cell, width: '75%' }}>
                            <Text>{bizNumber}</Text>
                        </View>
                    </View>
                    <View style={S.row}>
                        <View style={{ ...S.headerCell, width: '25%' }}>
                            <Text>보고기간</Text>
                        </View>
                        <View style={{ ...S.cellLeft, width: '75%' }}>
                            <Text>
                                {year}년 {month}월 1일 ~ {year}년 {month}월 {lastDay}일
                            </Text>
                        </View>
                    </View>
                </View>

                {/* 월간 집계 */}
                <Text style={S.sectionLabel}>■ 월간 생산 집계</Text>
                <View style={S.table}>
                    <View style={S.row}>
                        <View style={{ ...S.headerCell, width: '25%' }}>
                            <Text>총 로스팅 횟수</Text>
                        </View>
                        <View style={{ ...S.headerCell, width: '25%' }}>
                            <Text>총 투입량 (생두)</Text>
                        </View>
                        <View style={{ ...S.headerCell, width: '25%' }}>
                            <Text>총 생산량 (원두)</Text>
                        </View>
                        <View style={{ ...S.headerCell, width: '25%' }}>
                            <Text>평균 감모율</Text>
                        </View>
                    </View>
                    <View style={S.row}>
                        <View style={{ ...S.cell, width: '25%' }}>
                            <Text>{sessions.length} 회</Text>
                        </View>
                        <View style={{ ...S.cell, width: '25%' }}>
                            <Text>{totalInput.toFixed(2)} kg</Text>
                        </View>
                        <View style={{ ...S.cell, width: '25%' }}>
                            <Text>{totalOutput.toFixed(2)} kg</Text>
                        </View>
                        <View style={{ ...S.cell, width: '25%' }}>
                            <Text>{avgLossRate.toFixed(2)} %</Text>
                        </View>
                    </View>
                </View>

                {/* 로스팅 상세 내역 */}
                <Text style={S.sectionLabel}>■ 로스팅 작업 상세 내역</Text>
                <View style={S.table}>
                    {/* 헤더 */}
                    <View style={S.row}>
                        <Cell width={COL.no} bg="#f3f4f6" bold>No.</Cell>
                        <Cell width={COL.date} bg="#f3f4f6" bold>작업일자</Cell>
                        <Cell width={COL.bean} bg="#f3f4f6" bold>생두 Lot / 품명</Cell>
                        <Cell width={COL.input} bg="#f3f4f6" bold>{'투입량\n(kg)'}</Cell>
                        <Cell width={COL.output} bg="#f3f4f6" bold>{'생산량\n(kg)'}</Cell>
                        <Cell width={COL.loss} bg="#f3f4f6" bold>{'감모량\n(kg)'}</Cell>
                        <Cell width={COL.lossRate} bg="#f3f4f6" bold>{'감모율\n(%)'}</Cell>
                        <Cell width={COL.worker} bg="#f3f4f6" bold>작업자</Cell>
                        <Cell flex={1} bg="#f3f4f6" bold>비고</Cell>
                    </View>

                    {/* 데이터 행 */}
                    {sessions.map((s, idx) => (
                        <View key={idx} style={S.row} wrap={false}>
                            <Cell width={COL.no}>{String(idx + 1)}</Cell>
                            <Cell width={COL.date}>{s.date}</Cell>
                            <Cell width={COL.bean} align="left">{s.beanLot}</Cell>
                            <Cell width={COL.input} align="right">{s.inputKg.toFixed(2)}</Cell>
                            <Cell width={COL.output} align="right">{s.outputKg.toFixed(2)}</Cell>
                            <Cell width={COL.loss} align="right">{(s.inputKg - s.outputKg).toFixed(2)}</Cell>
                            <Cell width={COL.lossRate} align="right">{s.lossRate.toFixed(2)}</Cell>
                            <Cell width={COL.worker}>{s.worker}</Cell>
                            <Cell flex={1}>{s.note ?? ''}</Cell>
                        </View>
                    ))}

                    {/* 합계 행 */}
                    <View style={S.row}>
                        <Cell width={COL.no + COL.date + COL.bean} bold bg="#f3f4f6">합 계</Cell>
                        <Cell width={COL.input} align="right" bold>{totalInput.toFixed(2)}</Cell>
                        <Cell width={COL.output} align="right" bold>{totalOutput.toFixed(2)}</Cell>
                        <Cell width={COL.loss} align="right" bold>{totalLoss.toFixed(2)}</Cell>
                        <Cell width={COL.lossRate} align="right" bold>{avgLossRate.toFixed(2)}</Cell>
                        <Cell flex={1} bold>{''}</Cell>
                    </View>
                </View>

                {/* 확인 */}
                <Text style={S.sectionLabel}>■ 확인</Text>
                <View style={S.table}>
                    <View style={S.row}>
                        <View style={{ ...S.headerCell, width: '16.67%' }}>
                            <Text>작성자</Text>
                        </View>
                        <View style={{ ...S.cell, width: '16.67%' }}>
                            <Text>{writer}</Text>
                        </View>
                        <View style={{ ...S.headerCell, width: '16.67%' }}>
                            <Text>검토자</Text>
                        </View>
                        <View style={{ ...S.cell, width: '16.67%' }}>
                            <Text>{reviewer}</Text>
                        </View>
                        <View style={{ ...S.headerCell, width: '16.67%' }}>
                            <Text>대표자</Text>
                        </View>
                        <View style={{ ...S.cell, flex: 1 }}>
                            <Text>{representative}</Text>
                        </View>
                    </View>
                </View>

                {/* 하단 */}
                <Text style={S.footer}>
                    {`작성일: ${today}  |  본 보고서는 실제 로스팅 기록에 의거하여 작성되었습니다.`}
                </Text>
            </Page>
        </Document>
    );
};
