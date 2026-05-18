import { useRef, useState, useMemo } from 'react';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import { save } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';

interface RoastSession {
    date: string;
    beanLot: string;
    inputKg: number;
    outputKg: number;
    lossRate: number;
    profile: string;
    worker: string;
    note?: string;
}

interface MonthlyReportProps {
    year: number;
    month: number;
    businessName: string;
    ownerName: string;
    bizNumber?: string;
    totalRoasts: number;
    totalInputKg: number;
    totalOutputKg: number;
    avgLossRate: number;
    sessions: RoastSession[];
}

const A4_W = 210;
const A4_H = 297;

export const MonthlyProductionReport = ({
    year,
    month,
    businessName: initialBusinessName,
    ownerName: initialOwnerName,
    bizNumber: initialBizNumber = '',
    sessions: initialSessions,
}: MonthlyReportProps) => {
    const reportRef = useRef<HTMLDivElement>(null);
    const [saving, setSaving] = useState(false);

    // 상단 정보 (편집 가능)
    const [businessName, setBusinessName] = useState(initialBusinessName);
    const [ownerName, setOwnerName] = useState(initialOwnerName);
    const [bizNumber, setBizNumber] = useState(initialBizNumber);

    // 로스팅 상세 내역 (worker, note만 편집 가능)
    const [sessions, setSessions] = useState<RoastSession[]>(initialSessions);

    // 확인란 (contentEditable)
    const [writer, setWriter] = useState('');
    const [reviewer, setReviewer] = useState('');
    const [representative, setRepresentative] = useState('');

    // 실시간 집계
    const calculatedTotals = useMemo(() => {
        const totalInput = sessions.reduce((sum, s) => sum + s.inputKg, 0);
        const totalOutput = sessions.reduce((sum, s) => sum + s.outputKg, 0);
        const totalLoss = totalInput - totalOutput;
        const avgLoss = totalInput > 0 ? (totalLoss / totalInput) * 100 : 0;

        return {
            totalRoasts: sessions.length,
            totalInputKg: totalInput,
            totalOutputKg: totalOutput,
            avgLossRate: avgLoss,
        };
    }, [sessions]);

    const handleSavePdf = async () => {
        if (!reportRef.current || saving) return;
        setSaving(true);

        try {
            const canvas = await html2canvas(reportRef.current, {
                scale: 3,
                useCORS: true,
                backgroundColor: '#ffffff',
                onclone: (clonedDoc) => {
                    const style = clonedDoc.createElement('style');
                    style.textContent = `
                        * {
                            -webkit-print-color-adjust: exact !important;
                            color-adjust: exact !important;
                            font-family: "Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif !important;
                        }
                        table { border-collapse: collapse !important; }
                        th, td { vertical-align: middle !important; }
                        [contenteditable] {
                            font-family: inherit !important;
                            font-size: inherit !important;
                            color: #000000 !important;
                            outline: none !important;
                        }
                    `;
                    clonedDoc.head.appendChild(style);
                },
            });

            const imgW = A4_W;
            const imgH = (canvas.height * A4_W) / canvas.width;

            const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });

            let remainingH = imgH;
            let srcY = 0;
            let pageNum = 1;
            const totalPages = Math.ceil(imgH / A4_H);

            while (remainingH > 0) {
                const sliceH = Math.min(remainingH, A4_H);
                const srcYpx = (srcY / imgH) * canvas.height;
                const sliceHpx = (sliceH / imgH) * canvas.height;

                const pageCanvas = document.createElement('canvas');
                pageCanvas.width = canvas.width;
                pageCanvas.height = sliceHpx;
                const ctx = pageCanvas.getContext('2d')!;
                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = 'high';
                ctx.drawImage(canvas, 0, srcYpx, canvas.width, sliceHpx, 0, 0, canvas.width, sliceHpx);

                if (srcY > 0) pdf.addPage();
                pdf.addImage(pageCanvas.toDataURL('image/png', 1.0), 'PNG', 0, 0, imgW, sliceH);

                pdf.setFontSize(10);
                pdf.setTextColor(80);
                pdf.text(`${pageNum} / ${totalPages}`, A4_W - 15, A4_H - 8, { align: 'right' });

                pageNum++;
                srcY += sliceH;
                remainingH -= sliceH;
            }

            const defaultName = `${year}년_${String(month).padStart(2, '0')}월_생산보고서.pdf`;
            const path = await save({
                defaultPath: defaultName,
                filters: [{ name: 'PDF 문서', extensions: ['pdf'] }],
            });

            if (!path) return;

            const bytes = Array.from(new Uint8Array(pdf.output('arraybuffer')));
            await invoke('save_pdf', { path, data: bytes });
        } finally {
            setSaving(false);
        }
    };

    const today = new Date().toLocaleDateString('ko-KR', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    });

    const inputStyle = {
        width: '100%',
        height: '100%',
        border: 'none',
        backgroundColor: 'transparent',
        textAlign: 'center' as const,
        fontSize: '13px',
        fontFamily: 'inherit',
        outline: 'none',
        padding: '0 12px',
        color: '#000000',
    };

    // worker / note만 수정 가능
    const updateSession = (index: number, field: 'worker' | 'note', value: string) => {
        const newSessions = [...sessions];
        newSessions[index] = { ...newSessions[index], [field]: value };
        setSessions(newSessions);
    };

    return (
        <div className="font-sans">
            <div
                ref={reportRef}
                data-report="true"
                style={{
                    width: '198.5mm',
                    margin: '0 auto',
                    backgroundColor: '#ffffff',
                    padding: '18.75mm 18.75mm',
                    fontFamily: '"Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif',
                    fontSize: '13px',
                    lineHeight: '1.4',
                    color: '#000000',
                }}
            >
                {/* 문서 번호 */}
                <div style={{ textAlign: 'right', fontSize: '11px', marginBottom: '16px' }}>
                    문서번호: {year}-{String(month).padStart(2, '0')}-PROD
                </div>

                {/* 제목 */}
                <div style={{ textAlign: 'center', marginBottom: '24px' }}>
                    <div style={{ fontSize: '20px', fontWeight: '700', letterSpacing: '0.5em', marginBottom: '4px' }}>
                        커피원두 가공생산 월간보고서
                    </div>
                    <div style={{ fontSize: '14px' }}>
                        {year}년 {month}월분
                    </div>
                </div>

                {/* 업체 정보 테이블 - 상호 / 대표자 50:50 비율로 수정 */}
                <table
                    style={{
                        width: '100%',
                        borderCollapse: 'collapse',
                        border: '1px solid #000',
                        marginBottom: '20px',
                        fontSize: '12px',
                    }}
                >
                    <tbody>
                        <tr>
                            <td
                                style={{
                                    border: '1px solid #000',
                                    padding: '6px 12px',
                                    width: '25%',
                                    backgroundColor: '#f3f4f6',
                                    fontWeight: '700',
                                }}
                            >
                                상호
                            </td>
                            <td style={{ border: '1px solid #000', padding: '0', width: '25%' }}>
                                <input
                                    value={businessName}
                                    onChange={(e) => setBusinessName(e.target.value.trim())}
                                    style={inputStyle}
                                />
                            </td>
                            <td
                                style={{
                                    border: '1px solid #000',
                                    padding: '6px 12px',
                                    width: '25%',
                                    backgroundColor: '#f3f4f6',
                                    fontWeight: '700',
                                    textAlign: 'center',
                                }}
                            >
                                대표자
                            </td>
                            <td style={{ border: '1px solid #000', padding: '0', width: '25%' }}>
                                <input
                                    value={ownerName}
                                    onChange={(e) => setOwnerName(e.target.value.trim())}
                                    style={inputStyle}
                                />
                            </td>
                        </tr>
                        <tr>
                            <td
                                style={{
                                    border: '1px solid #000',
                                    padding: '6px 12px',
                                    backgroundColor: '#f3f4f6',
                                    fontWeight: '700',
                                }}
                            >
                                사업자등록번호
                            </td>
                            <td style={{ border: '1px solid #000', padding: '0' }} colSpan={3}>
                                <input
                                    value={bizNumber}
                                    onChange={(e) => setBizNumber(e.target.value.trim())}
                                    style={inputStyle}
                                />
                            </td>
                        </tr>
                        <tr>
                            <td
                                style={{
                                    border: '1px solid #000',
                                    padding: '6px 12px',
                                    backgroundColor: '#f3f4f6',
                                    fontWeight: '700',
                                }}
                            >
                                보고기간
                            </td>
                            <td style={{ border: '1px solid #000', padding: '6px 12px' }} colSpan={3}>
                                {year}년 {month}월 1일 ~ {year}년 {month}월 {new Date(year, month, 0).getDate()}일
                            </td>
                        </tr>
                    </tbody>
                </table>

                {/* 월간 집계 */}
                <div style={{ fontSize: '12px', fontWeight: '700', marginBottom: '4px' }}>■ 월간 생산 집계</div>
                <table
                    style={{
                        width: '100%',
                        borderCollapse: 'collapse',
                        border: '1px solid #000',
                        marginBottom: '20px',
                        fontSize: '12px',
                    }}
                >
                    <thead>
                        <tr style={{ backgroundColor: '#f3f4f6' }}>
                            <th
                                style={{
                                    border: '1px solid #000',
                                    padding: '6px 12px',
                                    fontWeight: '700',
                                    textAlign: 'center',
                                }}
                            >
                                총 로스팅 횟수
                            </th>
                            <th
                                style={{
                                    border: '1px solid #000',
                                    padding: '6px 12px',
                                    fontWeight: '700',
                                    textAlign: 'center',
                                }}
                            >
                                총 투입량 (생두)
                            </th>
                            <th
                                style={{
                                    border: '1px solid #000',
                                    padding: '6px 12px',
                                    fontWeight: '700',
                                    textAlign: 'center',
                                }}
                            >
                                총 생산량 (원두)
                            </th>
                            <th
                                style={{
                                    border: '1px solid #000',
                                    padding: '6px 12px',
                                    fontWeight: '700',
                                    textAlign: 'center',
                                }}
                            >
                                평균 감모율
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td style={{ border: '1px solid #000', padding: '8px 12px', textAlign: 'center' }}>
                                {calculatedTotals.totalRoasts} 회
                            </td>
                            <td style={{ border: '1px solid #000', padding: '8px 12px', textAlign: 'center' }}>
                                {calculatedTotals.totalInputKg.toFixed(2)} kg
                            </td>
                            <td style={{ border: '1px solid #000', padding: '8px 12px', textAlign: 'center' }}>
                                {calculatedTotals.totalOutputKg.toFixed(2)} kg
                            </td>
                            <td style={{ border: '1px solid #000', padding: '8px 12px', textAlign: 'center' }}>
                                {calculatedTotals.avgLossRate.toFixed(2)} %
                            </td>
                        </tr>
                    </tbody>
                </table>

                {/* 로스팅 작업 상세 내역 */}
                <div style={{ fontSize: '12px', fontWeight: '700', marginBottom: '4px' }}>■ 로스팅 작업 상세 내역</div>
                <table
                    style={{
                        width: '100%',
                        borderCollapse: 'collapse',
                        border: '1px solid #000',
                        marginBottom: '20px',
                        fontSize: '11px',
                    }}
                >
                    <thead>
                        <tr style={{ backgroundColor: '#f3f4f6' }}>
                            <th
                                style={{
                                    border: '1px solid #000',
                                    padding: '6px 4px',
                                    fontWeight: '700',
                                    textAlign: 'center',
                                    width: '35px',
                                }}
                            >
                                No.
                            </th>
                            <th
                                style={{
                                    border: '1px solid #000',
                                    padding: '6px 4px',
                                    fontWeight: '700',
                                    textAlign: 'center',
                                    width: '74px',
                                }}
                            >
                                작업일자
                            </th>
                            <th
                                style={{
                                    border: '1px solid #000',
                                    padding: '6px 4px',
                                    fontWeight: '700',
                                    textAlign: 'center',
                                }}
                            >
                                생두 Lot / 품명
                            </th>
                            <th
                                style={{
                                    border: '1px solid #000',
                                    padding: '6px 4px',
                                    fontWeight: '700',
                                    textAlign: 'center',
                                    width: '50px',
                                }}
                            >
                                투입량
                                <br />
                                (kg)
                            </th>
                            <th
                                style={{
                                    border: '1px solid #000',
                                    padding: '6px 4px',
                                    fontWeight: '700',
                                    textAlign: 'center',
                                    width: '50px',
                                }}
                            >
                                생산량
                                <br />
                                (kg)
                            </th>
                            <th
                                style={{
                                    border: '1px solid #000',
                                    padding: '6px 4px',
                                    fontWeight: '700',
                                    textAlign: 'center',
                                    width: '50px',
                                }}
                            >
                                감모량
                                <br />
                                (kg)
                            </th>
                            <th
                                style={{
                                    border: '1px solid #000',
                                    padding: '6px 4px',
                                    fontWeight: '700',
                                    textAlign: 'center',
                                    width: '50px',
                                }}
                            >
                                감모율
                                <br />
                                (%)
                            </th>
                            <th
                                style={{
                                    border: '1px solid #000',
                                    padding: '6px 4px',
                                    fontWeight: '700',
                                    textAlign: 'center',
                                    width: '55px',
                                }}
                            >
                                작업자
                            </th>
                            <th
                                style={{
                                    border: '1px solid #000',
                                    padding: '6px 4px',
                                    fontWeight: '700',
                                    textAlign: 'center',
                                    width: '65px',
                                }}
                            >
                                비고
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        {sessions.map((s, idx) => (
                            <tr key={idx}>
                                <td style={{ border: '1px solid #000', padding: '4px 6px', textAlign: 'center' }}>
                                    {idx + 1}
                                </td>
                                <td style={{ border: '1px solid #000', padding: '4px 6px', textAlign: 'center' }}>
                                    {s.date}
                                </td>
                                <td style={{ border: '1px solid #000', padding: '4px 6px' }}>{s.beanLot}</td>
                                <td style={{ border: '1px solid #000', padding: '4px 6px', textAlign: 'right' }}>
                                    {s.inputKg.toFixed(2)}
                                </td>
                                <td style={{ border: '1px solid #000', padding: '4px 6px', textAlign: 'right' }}>
                                    {s.outputKg.toFixed(2)}
                                </td>
                                <td style={{ border: '1px solid #000', padding: '4px 6px', textAlign: 'right' }}>
                                    {(s.inputKg - s.outputKg).toFixed(2)}
                                </td>
                                <td style={{ border: '1px solid #000', padding: '4px 6px', textAlign: 'right' }}>
                                    {s.lossRate.toFixed(2)}
                                </td>

                                {/* 작업자 */}
                                <td style={{ border: '1px solid #000', padding: '0' }}>
                                    <input
                                        value={s.worker}
                                        onChange={(e) => updateSession(idx, 'worker', e.target.value.trim())}
                                        style={{
                                            width: '100%',
                                            height: '100%',
                                            border: 'none',
                                            backgroundColor: 'transparent',
                                            textAlign: 'center' as const,
                                            fontSize: '13px',
                                            fontFamily: 'inherit',
                                            outline: 'none',
                                            padding: '0 8px',
                                            color: '#000000',
                                        }}
                                    />
                                </td>

                                {/* 비고 */}
                                <td style={{ border: '1px solid #000', padding: '0' }}>
                                    <input
                                        value={s.note ?? ''}
                                        onChange={(e) => updateSession(idx, 'note', e.target.value.trim())}
                                        style={{
                                            width: '100%',
                                            height: '100%',
                                            border: 'none',
                                            backgroundColor: 'transparent',
                                            textAlign: 'center' as const,
                                            fontSize: '13px',
                                            fontFamily: 'inherit',
                                            outline: 'none',
                                            padding: '0 8px',
                                            color: '#000000',
                                        }}
                                    />
                                </td>
                            </tr>
                        ))}
                        <tr style={{ backgroundColor: '#f3f4f6', fontWeight: '700' }}>
                            <td
                                style={{ border: '1px solid #000', padding: '8px 6px', textAlign: 'center' }}
                                colSpan={3}
                            >
                                합 계
                            </td>
                            <td style={{ border: '1px solid #000', padding: '8px 6px', textAlign: 'right' }}>
                                {calculatedTotals.totalInputKg.toFixed(2)}
                            </td>
                            <td style={{ border: '1px solid #000', padding: '8px 6px', textAlign: 'right' }}>
                                {calculatedTotals.totalOutputKg.toFixed(2)}
                            </td>
                            <td style={{ border: '1px solid #000', padding: '8px 6px', textAlign: 'right' }}>
                                {(calculatedTotals.totalInputKg - calculatedTotals.totalOutputKg).toFixed(2)}
                            </td>
                            <td style={{ border: '1px solid #000', padding: '8px 6px', textAlign: 'right' }}>
                                {calculatedTotals.avgLossRate.toFixed(2)}
                            </td>
                            <td style={{ border: '1px solid #000', padding: '8px 6px' }} colSpan={2}></td>
                        </tr>
                    </tbody>
                </table>

                {/* 확인란 */}
                <div style={{ fontSize: '12px', fontWeight: '700', marginBottom: '4px' }}>■ 확인</div>
                <table
                    style={{
                        width: '100%',
                        borderCollapse: 'collapse',
                        border: '1px solid #000',
                        marginBottom: '32px',
                        fontSize: '12px',
                    }}
                >
                    <tbody>
                        <tr>
                            <td
                                style={{
                                    border: '1px solid #000',
                                    padding: '6px 12px',
                                    width: '80px',
                                    backgroundColor: '#f3f4f6',
                                    fontWeight: '700',
                                    textAlign: 'center',
                                }}
                            >
                                작성자
                            </td>
                            <td style={{ border: '1px solid #000', padding: '0', width: '140px' }}>
                                <input
                                    value={writer}
                                    onChange={(e) => setWriter(e.target.value.trim())}
                                    style={inputStyle}
                                />
                            </td>
                            <td
                                style={{
                                    border: '1px solid #000',
                                    padding: '6px 12px',
                                    width: '80px',
                                    backgroundColor: '#f3f4f6',
                                    fontWeight: '700',
                                    textAlign: 'center',
                                }}
                            >
                                검토자
                            </td>
                            <td style={{ border: '1px solid #000', padding: '0', width: '140px' }}>
                                <input
                                    value={reviewer}
                                    onChange={(e) => setReviewer(e.target.value.trim())}
                                    style={inputStyle}
                                />
                            </td>
                            <td
                                style={{
                                    border: '1px solid #000',
                                    padding: '6px 12px',
                                    width: '80px',
                                    backgroundColor: '#f3f4f6',
                                    fontWeight: '700',
                                    textAlign: 'center',
                                }}
                            >
                                대표자
                            </td>
                            <td style={{ border: '1px solid #000', padding: '0' }}>
                                <input
                                    value={representative}
                                    onChange={(e) => setRepresentative(e.target.value.trim())}
                                    style={inputStyle}
                                />
                            </td>
                        </tr>
                    </tbody>
                </table>

                {/* 하단 */}
                <div
                    style={{
                        fontSize: '10px',
                        textAlign: 'center',
                        borderTop: '1px solid #000',
                        paddingTop: '8px',
                        color: '#4b5563',
                    }}
                >
                    <span>작성일: {today}</span>
                    <span style={{ margin: '0 16px' }}>|</span>
                    <span>본 보고서는 실제 로스팅 기록에 의거하여 작성되었습니다.</span>
                </div>
            </div>

            {/* 저장 버튼 */}
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: '24px' }}>
                <button
                    onClick={handleSavePdf}
                    disabled={saving}
                    style={{
                        padding: '10px 24px',
                        border: '1px solid #000',
                        fontSize: '14px',
                        backgroundColor: saving ? '#f3f4f6' : '#ffffff',
                        cursor: saving ? 'not-allowed' : 'pointer',
                        opacity: saving ? 0.6 : 1,
                    }}
                >
                    {saving ? 'PDF 생성 중...' : 'PDF 저장'}
                </button>
            </div>
        </div>
    );
};
