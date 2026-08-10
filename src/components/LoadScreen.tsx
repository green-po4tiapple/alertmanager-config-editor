/**
 * Start screen. Nothing is preloaded: the tree is built only from what the user
 * actually supplied — the example loaded by an explicit click, a paste, a file, or
 * a fetch from a live Alertmanager.
 *
 * Order matters here and was decided by watching a cold visit. Someone who has just
 * found this page cannot paste a production config yet and certainly will not hand
 * over their Alertmanager URL, so the one thing they *can* do — see it working on
 * an example — comes first and is the primary button. Fetching from a live
 * Alertmanager is the most powerful entry point but the least appropriate first
 * ask, so it is collapsed at the bottom.
 */

import { useRef, useState } from 'react';
import { parseConfig } from '../core/parse';
import type { ParseSuccess } from '../core/parse';
import { fetchAlertmanagerConfig, lastUsedBase } from '../core/enrich';
import { endpointCandidates, endpointNote } from '../core/urls';
import { EXAMPLE_CONFIG } from '../demo/exampleConfig';
import { Rich } from '../i18n/Rich';
import { useT } from '../i18n/react';

export function LoadScreen({
  onLoaded,
}: {
  onLoaded: (
    parsed: ParseSuccess,
    sourceText: string,
    origin?: { kind: 'api'; url: string },
  ) => void;
}): React.JSX.Element {
  const t = useT();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [amUrl, setAmUrl] = useState('');
  const [amAuth, setAmAuth] = useState(false);
  const [amUser, setAmUser] = useState('');
  const [amPassword, setAmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = (raw: string, origin?: { kind: 'api'; url: string }): void => {
    const result = parseConfig(raw);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    onLoaded(result, raw, origin);
  };

  /** Pulls the config from a running Alertmanager, so nothing has to be pasted. */
  const pullFromAlertmanager = async (): Promise<void> => {
    const url = amUrl.trim();
    if (!url) return;
    setBusy(true);
    setError(null);
    try {
      const config = await fetchAlertmanagerConfig({
        url,
        ...(amAuth && amUser !== '' ? { auth: { username: amUser, password: amPassword } } : {}),
        timeoutMs: 30000,
        maxSeriesPerRule: 1,
      });
      setText(config);
      const used = lastUsedBase(url);
      const note = used ? endpointNote(url, used) : null;
      if (note) setAmUrl(used!);
      load(config, { kind: 'api', url: used ?? url });
    } catch (e) {
      const message = (e as Error).message;
      setError(
        message.startsWith('HTTP ')
          ? t.load.amHttpError(message)
          : t.load.amNetworkError(message, endpointCandidates(url, location.protocol).join(', ')),
      );
    } finally {
      setBusy(false);
    }
  };

  const readFile = (file: File): void => {
    const reader = new FileReader();
    reader.onload = () => {
      const content = String(reader.result ?? '');
      setText(content);
      load(content);
    };
    reader.readAsText(file);
  };

  return (
    <div className="load-screen">
      <div className="load-card">
        <div className="load-hero">
          <h1>{t.load.title}</h1>
          <p className="load-lede">
            <Rich text={t.load.lede} />
          </p>
          <div className="load-cta">
            <button
              type="button"
              className="btn primary big"
              onClick={() => {
                setText(EXAMPLE_CONFIG);
                load(EXAMPLE_CONFIG);
              }}
            >
              {t.load.loadExample}
            </button>
            <span className="hint">{t.load.exampleHint}</span>
          </div>
        </div>

        <div className="or-divider">{t.load.orYourOwn}</div>

        <span className="hint">
          <Rich text={t.load.subtitle} />
        </span>

        <textarea
          className={dragging ? 'dragover' : undefined}
          value={text}
          spellCheck={false}
          placeholder={'route:\n  receiver: "null"\n  routes:\n    - receiver: team_oncall\n      matchers:\n        - team="sre"\n        - severity="critical"'}
          onChange={(e) => setText(e.target.value)}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const file = e.dataTransfer.files[0];
            if (file) readFile(file);
          }}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') load(text);
          }}
        />

        {error && <div className="load-error">{error}</div>}

        <div className="load-actions">
          <button type="button" className="btn primary" disabled={!text.trim()} onClick={() => load(text)}>
            {t.load.loadTree}
          </button>
          <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
            {t.load.openFile}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".yaml,.yml,.txt,text/yaml,text/plain"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) readFile(file);
              e.target.value = '';
            }}
          />
          <span className="hint">{t.load.dropHint}</span>
        </div>

        {/*
         * Collapsed on purpose: powerful for someone who already trusts the page,
         * an unreasonable request for someone who arrived a minute ago.
         */}
        <details className="am-pull">
          <summary>{t.load.pullTitle}</summary>
          <span className="hint">
            <Rich text={t.load.pullHint} />
          </span>
          <div className="batch-form">
            <label className="field wide">
              <span>Alertmanager</span>
              <input
                type="text"
                placeholder="https://alertmanager.example.com"
                value={amUrl}
                spellCheck={false}
                onChange={(e) => setAmUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void pullFromAlertmanager();
                }}
              />
            </label>
            <button
              type="button"
              className="btn"
              disabled={!amUrl.trim() || busy}
              onClick={() => void pullFromAlertmanager()}
            >
              {busy ? t.load.pullBusy : `↓ ${t.load.pullButton}`}
            </button>
            <label className="chk">
              <input
                type="checkbox"
                checked={amAuth}
                onChange={(e) => setAmAuth(e.target.checked)}
              />
              {t.load.authNeeded}
            </label>
          </div>
          {amAuth && (
            <div className="batch-form">
              <label className="field">
                <span>{t.load.username}</span>
                <input
                  type="text"
                  value={amUser}
                  autoComplete="off"
                  onChange={(e) => setAmUser(e.target.value)}
                />
              </label>
              <label className="field">
                <span>{t.load.password}</span>
                <input
                  type="password"
                  value={amPassword}
                  autoComplete="off"
                  onChange={(e) => setAmPassword(e.target.value)}
                />
              </label>
            </div>
          )}
        </details>

        <div className="load-facts">
          <span>
            <Rich text={t.load.factSecrets} />
          </span>
          <span>
            <Rich text={t.load.factNetwork} />
          </span>
          <span>
            <Rich text={t.load.factOriginal} />
          </span>
        </div>
      </div>
    </div>
  );
}
