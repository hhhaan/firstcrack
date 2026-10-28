import { RoastMonitor } from '@features/active-roast/ui/RoastMonitor';
import { initI18n } from '@shared/i18n';
import { logger } from '@shared/lib/logger';
import { reactRootOptions } from '@shared/lib/sentry';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './App.css';

const bootstrap = async () => {
    await initI18n({ persist: false });
    const element = document.getElementById('root');
    if (!element) throw new Error('Roast monitor root is missing');
    createRoot(
        element,
        reactRootOptions((error) => logger.error('[react] handled error', error)),
    ).render(
        <StrictMode>
            <RoastMonitor />
        </StrictMode>,
    );
};

void bootstrap();
