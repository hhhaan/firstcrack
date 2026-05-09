import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './App';
import { initI18n } from './shared/i18n';
import 'uplot/dist/uPlot.min.css';

const queryClient = new QueryClient();

const bootstrap = async () => {
    await initI18n();

    ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
        <React.StrictMode>
            <QueryClientProvider client={queryClient}>
                <App />
            </QueryClientProvider>
        </React.StrictMode>,
    );
};

void bootstrap();
