import { Languages } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { setLanguage, supportedLanguages } from '@shared/i18n';

export const GeneralSettingsTab = () => {
    const { t, i18n } = useTranslation();

    return (
        <section className="bg-white border border-[#E5E7EB] rounded-xl p-5">
            <div className="mb-4">
                <div className="flex items-center gap-2 mb-0.5">
                    <Languages size={16} strokeWidth={1.8} className="text-[#6B7280] shrink-0" />
                    <h4 className="text-[15px] font-semibold text-[#111827] m-0">
                        {t('settings.tabs.general.language')}
                    </h4>
                </div>
                <p className="text-[13px] text-[#6B7280] m-0">{t('settings.tabs.general.languageDescription')}</p>
            </div>

            <div className="grid gap-1.5">
                {supportedLanguages.map((language) => {
                    const active = i18n.resolvedLanguage === language;

                    return (
                        <label
                            key={language}
                            className="flex items-center gap-3 px-4 py-3 rounded-lg border border-[#E5E7EB] bg-white cursor-pointer"
                        >
                            <input
                                type="checkbox"
                                checked={active}
                                onChange={() => void setLanguage(language)}
                                className="w-4 h-4 accent-[#111827]"
                            />
                            <span className="text-[14px] font-medium text-[#111827]">{t(`language.${language}`)}</span>
                        </label>
                    );
                })}
            </div>
        </section>
    );
};
