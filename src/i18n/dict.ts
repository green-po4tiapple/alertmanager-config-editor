/**
 * Locale plumbing, deliberately free of React.
 *
 * `src/core/` produces user-visible text (parse errors, enrichment notes, outcome
 * labels) and must not import React — that invariant is what keeps the core
 * testable in plain vitest without a DOM. So the current language lives in a
 * module-level variable that core reads through `dict()`, while React components
 * read it through `useT()` (see `./react`).
 *
 * One language per tab is the only mode this app has, so a module-level variable
 * is honest here rather than a hidden global: there is no second locale that could
 * be rendered at the same time.
 */

import { en } from './en';
import { ru } from './ru';

export type Lang = 'ru' | 'en';

/**
 * The Russian dictionary is the reference shape. `en` is typed against it, so a
 * missing key — or a parameterised message whose signature drifted — is a compile
 * error rather than a blank label at runtime.
 */
export type Dict = typeof ru;

const DICTS: Record<Lang, Dict> = { ru, en };

const STORAGE_KEY = 'am-editor-lang';

let current: Lang = 'ru';

/** Language guessed from the browser, used when nothing was chosen yet. */
export function detectLang(): Lang {
  if (typeof navigator === 'undefined') return 'en';
  return navigator.language.toLowerCase().startsWith('ru') ? 'ru' : 'en';
}

/**
 * Reads the previously chosen language. This is the only thing the app ever puts
 * into browser storage — the config being edited never goes there.
 */
export function loadLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'ru' || saved === 'en') return saved;
  } catch {
    // Private mode / storage disabled: fall back to the browser language.
  }
  return detectLang();
}

export function setLang(lang: Lang): void {
  current = lang;
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // Not being able to remember the choice is not worth failing over.
  }
  if (typeof document !== 'undefined') document.documentElement.lang = lang;
}

export function getLang(): Lang {
  return current;
}

/** Current dictionary. Call it at use time — never cache the result in a module. */
export function dict(): Dict {
  return DICTS[current];
}
