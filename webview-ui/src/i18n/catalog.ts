import { ru } from './ru.js';
export type Language = 'en' | 'ru';
export function countNoun(
  count: number,
  noun: 'offices' | 'agents' | 'unread results',
  language: Language,
): string {
  if (language === 'en')
    return count === 1
      ? { offices: 'office', agents: 'agent', 'unread results': 'unread result' }[noun]
      : noun;
  const forms = {
    offices: ['офис', 'офиса', 'офисов'],
    agents: ['агент', 'агента', 'агентов'],
    'unread results': [
      'непрочитанный результат',
      'непрочитанных результата',
      'непрочитанных результатов',
    ],
  }[noun];
  const mod100 = count % 100,
    mod10 = count % 10;
  return forms[
    mod100 >= 11 && mod100 <= 14 ? 2 : mod10 === 1 ? 0 : mod10 >= 2 && mod10 <= 4 ? 1 : 2
  ];
}
export function translate(
  key: string,
  locale: Language,
  values: Record<string, string | number> = {},
): string {
  const text = locale === 'ru' ? (ru[key] ?? key) : key;
  return text.replace(/\{(\w+)\}/g, (match, key: string) => String(values[key] ?? match));
}
export const localeName = (language: Language): string => (language === 'ru' ? 'ru-RU' : 'en-US');
