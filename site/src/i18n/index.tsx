import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

import en from './en';
import ko from './ko';
import type { Lang } from './types';

export type { HostCategory, Lang } from './types';

export type Dict = typeof ko;

const STORAGE_KEY = 'scriptca-lang';

const dict: Record<Lang, Dict> = { ko, en };

type I18nContextValue = {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: Dict;
};

const I18nContext = createContext<I18nContextValue | null>(null);

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'ko' || saved === 'en') return saved;
    return navigator.language.startsWith('ko') ? 'ko' : 'en';
  } catch {
    return 'ko';
  }
}

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>(initialLang);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      /* storage unavailable — in-memory only */
    }
    document.documentElement.lang = lang;
    document.title = dict[lang].meta.title;
  }, [lang]);

  return (
    <I18nContext.Provider value={{ lang, setLang, t: dict[lang] }}>{children}</I18nContext.Provider>
  );
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside LangProvider');
  return ctx;
}
