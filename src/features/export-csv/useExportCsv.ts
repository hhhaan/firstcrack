import { downloadCsv } from '@shared/lib/download';
import { logger } from '@shared/lib/logger';
import type { RoastSessionWithRelations } from '@shared/types/database.types';
import { downloadDir, join } from '@tauri-apps/api/path';
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
                const path = await join(await downloadDir(), filename);

                const confirmed = await confirm(t('history.exportConfirm', { path, count: sessions.length }), {
                    title: t('history.exportTitle'),
                    kind: 'info',
                    okLabel: t('history.exportOkLabel'),
                    cancelLabel: t('history.exportCancelLabel'),
                });
                if (!confirmed) return;

                downloadCsv(sessionsToCsv(sessions), filename);
            } catch (err) {
                logger.capture(err, { context: 'export csv' });
            }
        },
        [t],
    );
};
