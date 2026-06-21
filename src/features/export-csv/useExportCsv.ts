import type { RoastSessionWithRelations } from '@shared/types/database.types';
import { downloadDir } from '@tauri-apps/api/path';
import { confirm, message } from '@tauri-apps/plugin-dialog';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { sessionsToCsv } from './lib/csv-export';

export const useExportCsv = () => {
    const { t } = useTranslation();

    return useCallback(
        async (sessions: RoastSessionWithRelations[]) => {
            try {
                if (sessions.length === 0) {
                    await message(t('history.exportNoSessions'), { title: t('history.exportTitle'), kind: 'info' });
                    return;
                }

                const today = new Date().toISOString().slice(0, 10);
                const filename = `roast-history-${today}.csv`;
                const dir = await downloadDir();
                const path = `${dir}${filename}`;

                const confirmed = await confirm(t('history.exportConfirm', { path, count: sessions.length }), {
                    title: t('history.exportTitle'),
                    kind: 'info',
                    okLabel: t('history.exportOkLabel'),
                    cancelLabel: t('history.exportCancelLabel'),
                });
                if (!confirmed) return;

                const csv = sessionsToCsv(sessions);
                const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = filename;
                a.style.display = 'none';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            } catch (err) {
                console.error('Export CSV failed:', err);
            }
        },
        [t],
    );
};
