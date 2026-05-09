import { Languages } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { setLanguage, supportedLanguages } from '@shared/i18n';

export const GeneralSettingsTab = () => {
    const { t, i18n } = useTranslation();

    return (
        <section className="rounded-[20px] p-5 bg-linear-to-b from-[rgba(245,242,239,0.75)] to-[rgba(255,255,255,0.92)] border border-[rgba(0,0,0,0.06)] shadow-warm">
            <div className="mb-3.5">
                <div className="flex items-center gap-2 mb-1">
                    <Languages size={16} strokeWidth={1.9} className="text-secondary shrink-0" />
                    <h4 className="text-base font-semibold text-primary m-0">{t('settings.tabs.general.language')}</h4>
                </div>
                <p className="text-[13px] text-secondary">{t('settings.tabs.general.languageDescription')}</p>
            </div>

            <div className="flex gap-2 flex-wrap">
                {supportedLanguages.map((language) => {
                    const active = i18n.resolvedLanguage === language;

                    return (
                        <button
                            key={language}
                            onClick={() => void setLanguage(language)}
                            className={`border-none rounded-full px-3.5 py-2.25 cursor-pointer text-[13px] font-semibold ${
                                active
                                    ? 'bg-primary text-white shadow-card'
                                    : 'bg-[rgba(255,255,255,0.88)] text-secondary shadow-inset'
                            }`}
                        >
                            {t(`language.${language}`)}
                        </button>
                    );
                })}
            </div>
        </section>
    );
};
