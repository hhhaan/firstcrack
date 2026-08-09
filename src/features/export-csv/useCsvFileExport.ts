import { downloadCsv } from '@shared/lib/download';
import { downloadDir, join } from '@tauri-apps/api/path';
import { confirm } from '@tauri-apps/plugin-dialog';
import { useCallback } from 'react';

export interface CsvExportLabels {
    title: string;
    okLabel: string;
    cancelLabel: string;
    /** 저장 경로가 정해진 뒤에야 문구를 만들 수 있어 함수로 받는다 */
    confirmMessage: (path: string) => string;
}

/**
 * CSV 파일 저장 절차 — 다운로드 폴더 경로 확정 → 확인 다이얼로그 → 쓰기.
 *
 * 무엇을 내보내는지는 관심 없다(세션 목록이든 프로파일이든). 저장 위치·확인
 * 절차·취소 처리를 한 곳에 두려는 것이므로, 새 export 기능은 CSV 문자열만
 * 만들어 여기에 넘긴다.
 *
 * @returns 사용자가 확인해 실제로 저장했으면 true, 취소했으면 false
 */
export const useCsvFileExport = () =>
    useCallback(async (csv: string, filename: string, labels: CsvExportLabels): Promise<boolean> => {
        const path = await join(await downloadDir(), filename);
        const confirmed = await confirm(labels.confirmMessage(path), {
            title: labels.title,
            kind: 'info',
            okLabel: labels.okLabel,
            cancelLabel: labels.cancelLabel,
        });
        if (!confirmed) return false;

        downloadCsv(csv, filename);
        return true;
    }, []);
