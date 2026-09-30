import { useAppVersion } from '@shared/lib/useAppVersion';
import { useTranslation } from 'react-i18next';
import { SettingsOptionRow, settingsOptionLabelCls } from './SettingsOptionRow';
import { SettingsSection } from './SettingsSection';

export const SoftwareSettingsTab = () => {
    const { t } = useTranslation();
    const version = useAppVersion();

    return (
        <div className="grid gap-6">
            <SettingsSection>
                <SettingsSection.Header
                    title={t('settings.tabs.software.version')}
                    description={t('settings.tabs.software.versionDescription')}
                />
                <SettingsSection.Body>
                    <SettingsOptionRow>
                        <span className={settingsOptionLabelCls}>{version ? `v${version}` : '-'}</span>
                    </SettingsOptionRow>
                </SettingsSection.Body>
            </SettingsSection>
        </div>
    );
};
