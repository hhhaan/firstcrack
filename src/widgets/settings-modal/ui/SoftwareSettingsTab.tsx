import { useAppVersion } from '@widgets/bottom-toolbar/model/useAppVersion';
import { useTranslation } from 'react-i18next';

const sectionCls = 'bg-white dark:bg-[#181d21] border border-[#E5E7EB] dark:border-[#585d61] rounded-xl p-5';

export const SoftwareSettingsTab = () => {
    const { t } = useTranslation();
    const version = useAppVersion();

    return (
        <div className="grid gap-4">
            <section className={sectionCls}>
                <div className="mb-4">
                    <h4 className="text-[15px] font-semibold text-[#111827] dark:text-[#e5e5e5] m-0 mb-1">
                        {t('settings.tabs.software.version')}
                    </h4>
                    <p className="text-[13px] text-[#6B7280] dark:text-[#999] m-0">
                        {t('settings.tabs.software.versionDescription')}
                    </p>
                </div>

                <div className="flex items-center gap-3 px-4 py-3 rounded-lg border border-[#E5E7EB] dark:border-[#585d61] bg-white dark:bg-[#181d21]">
                    <span className="text-[14px] font-medium text-[#111827] dark:text-[#e5e5e5]">
                        {version ? `v${version}` : '-'}
                    </span>
                </div>
            </section>
        </div>
    );
};
