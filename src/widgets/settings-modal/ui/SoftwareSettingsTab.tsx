import { SectionCard } from '@shared/ui/SectionCard';
import { useAppVersion } from '@widgets/bottom-toolbar/model/useAppVersion';
import { useTranslation } from 'react-i18next';
import { SettingsOptionRow, settingsOptionLabelCls } from './SettingsOptionRow';

export const SoftwareSettingsTab = () => {
    const { t } = useTranslation();
    const version = useAppVersion();

    return (
        <div className="grid gap-4">
            <SectionCard>
                <SectionCard.Header
                    title={t('settings.tabs.software.version')}
                    description={t('settings.tabs.software.versionDescription')}
                />
                <SectionCard.Body>
                    <SettingsOptionRow>
                        <span className={settingsOptionLabelCls}>{version ? `v${version}` : '-'}</span>
                    </SettingsOptionRow>
                </SectionCard.Body>
            </SectionCard>
        </div>
    );
};
