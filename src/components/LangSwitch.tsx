/** Language switch. Sits both in the topbar and on the start screen. */

import { useLang } from '../i18n/react';
import type { Lang } from '../i18n/dict';

const LANGS: Array<{ id: Lang; label: string; title: string }> = [
  { id: 'en', label: 'EN', title: 'English' },
  { id: 'ru', label: 'RU', title: 'Русский' },
];

export function LangSwitch(): React.JSX.Element {
  const { lang, setLang } = useLang();
  return (
    <div className="segmented" title="Language">
      {LANGS.map((l) => (
        <button
          key={l.id}
          type="button"
          className={lang === l.id ? 'active' : ''}
          title={l.title}
          onClick={() => setLang(l.id)}
        >
          {l.label}
        </button>
      ))}
    </div>
  );
}
