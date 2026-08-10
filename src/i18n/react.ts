/**
 * React side of i18n. Kept apart from `./dict` so that `src/core/` can translate
 * its messages without pulling React into modules that must stay DOM-free.
 */

import { createContext, useContext } from 'react';
import { dict, type Dict, type Lang } from './dict';

export interface LangApi {
  lang: Lang;
  setLang: (lang: Lang) => void;
}

export const LangContext = createContext<LangApi>({
  lang: 'ru',
  setLang: () => {},
});

/**
 * Translations for the current language.
 *
 * Subscribing to the context (rather than calling `dict()` directly) is what makes
 * components re-render when the language changes — `dict()` alone is just a
 * variable read and React would never know it moved.
 */
export function useT(): Dict {
  useContext(LangContext);
  return dict();
}

export function useLang(): LangApi {
  return useContext(LangContext);
}
