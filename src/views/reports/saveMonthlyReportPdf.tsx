import { pdf } from '@react-pdf/renderer';
import { save } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { MonthlyReportPdfDocument, type MonthlyReportPdfData } from './MonthlyReportPdfDocument';

export const saveMonthlyReportPdf = async (data: MonthlyReportPdfData): Promise<void> => {
    const blob = await pdf(<MonthlyReportPdfDocument data={data} />).toBlob();

    const defaultName = `${data.year}년_${String(data.month).padStart(2, '0')}월_생산보고서.pdf`;
    const path = await save({
        defaultPath: defaultName,
        filters: [{ name: 'PDF 문서', extensions: ['pdf'] }],
    });
    if (!path) return;

    const bytes = Array.from(new Uint8Array(await blob.arrayBuffer()));
    await invoke('save_pdf', { path, data: bytes });
};
