import { setLanguage, supportedLanguages } from '@shared/i18n';
import { useThemeStore } from '@shared/store/theme';
import { FormSelect } from '@shared/ui/FormSelect';
import { useTranslation } from 'react-i18next';

export const LoginHeader = () => {
    const { t, i18n } = useTranslation();
    const resolvedTheme = useThemeStore((state) => state.resolvedTheme);

    return (
        <header className="flex flex-wrap items-center justify-between gap-x-5 gap-y-3">
            <div className="flex shrink-0 items-center gap-2 text-base font-medium tracking-[-0.5px] text-primary">
                <img
                    src={resolvedTheme === 'dark' ? '/logo_dark.png' : '/logo.png'}
                    alt=""
                    className="h-6 w-6 shrink-0"
                />
                First Crack
            </div>
            <FormSelect
                id="auth-language"
                aria-label={t('settings.tabs.general.language')}
                value={i18n.resolvedLanguage}
                onChange={(event) => {
                    const language = supportedLanguages.find((value) => value === event.target.value);
                    if (language) void setLanguage(language);
                }}
                wrapperClassName="w-24"
                className="h-8 min-h-8 justify-between border-0 bg-transparent px-2 py-1 text-xs shadow-none"
            >
                {supportedLanguages.map((language) => (
                    <option key={language} value={language}>
                        {t(`language.${language}`)}
                    </option>
                ))}
            </FormSelect>
        </header>
    );
};
