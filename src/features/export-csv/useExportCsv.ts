import { logger } from '@shared/lib/logger';
import type { RoastSessionWithRelations } from '@shared/types/database.types';
import { message } from '@tauri-apps/plugin-dialog';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { sessionsToCsv } from './lib/csv-export';
import { useCsvFileExport } from './useCsvFileExport';

export const useExportCsv = () => {
    const { t } = useTranslation();
    const exportFile = useCsvFileExport();

    return useCallback(
        async (sessions: RoastSessionWithRelations[]) => {
            try {
                if (sessions.length === 0) {
                    await message(t('history.exportNoSessions'), { title: t('history.exportTitle'), kind: 'info' });
                    return;
                }

                const today = new Date().toISOString().slice(0, 10);
                await exportFile(sessionsToCsv(sessions), `roast-history-${today}.csv`, {
                    title: t('history.exportTitle'),
                    okLabel: t('history.exportOkLabel'),
                    cancelLabel: t('history.exportCancelLabel'),
                    confirmMessage: (path) => t('history.exportConfirm', { path, count: sessions.length }),
                });
            } catch (err) {
                logger.capture(err, { context: 'export csv' });
            }
        },
        [t, exportFile],
    );
};
