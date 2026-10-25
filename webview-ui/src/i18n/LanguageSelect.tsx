import { useLanguage } from './index.js';

export function LanguageSelect() {
  const { language, setLanguage, t } = useLanguage();
  return (
    <label className="opa-language">
      {t('Language')}{' '}
      <select
        aria-label={t('Language')}
        value={language}
        onChange={(event) => setLanguage(event.target.value === 'ru' ? 'ru' : 'en')}
      >
        <option value="ru">Русский</option>
        <option value="en">English</option>
      </select>
    </label>
  );
}
