import { useRoastingStore } from '@features/active-roast';
import { type UpdateState, useUpdater } from '@features/updater';
import { useAppVersion } from '@shared/lib/useAppVersion';
import { useToastStore } from '@shared/store/toast';
import { SurfaceButton } from '@shared/ui/SurfaceButton';
import { useTranslation } from 'react-i18next';
import { SettingsOptionRow, settingsOptionDescCls, settingsOptionLabelCls } from './SettingsOptionRow';
import { SettingsSection } from './SettingsSection';

function updateStatusText(t: (key: string, options?: Record<string, unknown>) => string, state: UpdateState) {
    switch (state.status) {
        case 'checking':
            return t('updater.checking');
        case 'available':
            return t('updater.available', { version: state.version ?? '' });
        case 'downloading':
            return state.progress > 0
                ? t('updater.downloadingProgress', { progress: state.progress })
                : t('updater.downloading');
        case 'ready':
            return t('updater.ready', { version: state.version ?? '' });
        case 'applying':
            return t('updater.applying');
        case 'error':
            return t(state.error ?? 'updater.checkError');
        case 'current':
            return t('updater.upToDate');
        default:
            return null;
    }
}

export const SoftwareSettingsTab = () => {
    const { t } = useTranslation();
    const version = useAppVersion();
    const { state, checkForUpdate, checkAndDownload, applyAndRelaunch } = useUpdater();
    const isRoastIdle = useRoastingStore((s) => s.phase === 'idle');
    const statusText = updateStatusText(t, state);
    const busy = state.status === 'checking' || state.status === 'downloading' || state.status === 'applying';
    const restart = state.status === 'ready';
    const available = state.status === 'available';

    return (
        <div className="grid gap-8">
            <SettingsSection>
                <SettingsSection.Header
                    title={t('settings.tabs.software.version')}
                    description={t('settings.tabs.software.versionDescription')}
                />
                <SettingsSection.Body>
                    <SettingsOptionRow justify="between" align="center">
                        <div className="min-w-0">
                            <div className={settingsOptionLabelCls}>{version ? `v${version}` : '—'}</div>
                            {statusText ? <div className={settingsOptionDescCls}>{statusText}</div> : null}
                        </div>
                        <SurfaceButton
                            disabled={busy}
                            onClick={() => {
                                if (restart) {
                                    if (!isRoastIdle) {
                                        useToastStore.getState().show(t('updater.finishRoastFirst'), 'info');
                                        return;
                                    }
                                    void applyAndRelaunch();
                                    return;
                                }
                                if (available) {
                                    void checkAndDownload();
                                    return;
                                }
                                void checkForUpdate();
                            }}
                        >
                            {restart
                                ? t('updater.restart')
                                : available
                                  ? t('updater.update')
                                  : t('settings.tabs.software.check')}
                        </SurfaceButton>
                    </SettingsOptionRow>
                </SettingsSection.Body>
            </SettingsSection>
        </div>
    );
};
