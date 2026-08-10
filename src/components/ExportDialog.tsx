/**
 * Export. The single point where the user deliberately takes a result out.
 * The "whole file" tab is assembled as the ORIGINAL with only the route: block
 * replaced, so everything else — secrets in receivers: included — is carried over
 * verbatim.
 */

import { useMemo, useState } from 'react';
import { serializeRoute, spliceRouteBlock } from '../core/serialize';
import { parseConfig } from '../core/parse';
import { parseMatcher } from '../core/matchers';
import { walkTree } from '../core/tree';
import { collapseUnchanged, diffText } from '../core/diff';
import type { RouteNode } from '../core/types';
import { Rich } from '../i18n/Rich';
import { useT } from '../i18n/react';
import type { LoadedSource } from '../state/store';
import { Modal } from './Modal';

type Tab = 'route' | 'file' | 'diff';

export function ExportDialog({
  root,
  source,
  baselineYaml,
  onClose,
  onToast,
}: {
  root: RouteNode;
  source: LoadedSource;
  /** YAML right after loading — the diff baseline, free of normalisation noise. */
  baselineYaml: string;
  onClose: () => void;
  onToast: (message: string) => void;
}): React.JSX.Element {
  const t = useT();
  // A config taken from /api/v2/status carries `<secret>` in place of tokens, so
  // writing that file back to a cluster would break every integration it has.
  const fromApi = source.origin === 'api';
  const canSpliceFile = source.wholeFile && source.routeBlock !== null && !fromApi;
  const [tab, setTab] = useState<Tab>('route');

  const routeYaml = useMemo(() => serializeRoute(root), [root]);
  const fileYaml = useMemo(
    () => (canSpliceFile ? spliceRouteBlock(source.text, source.routeBlock!, routeYaml) : ''),
    [canSpliceFile, source.text, source.routeBlock, routeYaml],
  );

  const diff = useMemo(() => diffText(baselineYaml, routeYaml), [baselineYaml, routeYaml]);
  const diffGroups = useMemo(() => collapseUnchanged(diff.lines), [diff.lines]);
  /** What the "Changes" tab copies or saves — a plain unified diff. */
  const diffPlain = useMemo(
    () =>
      diffGroups
        .map((g) =>
          g
            .map((l) => `${l.op === 'add' ? '+' : l.op === 'del' ? '-' : ' '}${l.text}`)
            .join('\n'),
        )
        .join('\n@@\n'),
    [diffGroups],
  );

  const text = tab === 'file' ? fileYaml : tab === 'diff' ? diffPlain : routeYaml;

  /** Self-check: the export must parse back. */
  const selfCheck = useMemo(() => {
    const again = parseConfig(routeYaml);
    if (!again.ok) return t.exportDialog.selfCheckUnparsable(again.error);
    const invalid: string[] = [];
    walkTree(root, (n) => {
      for (const m of n.matchers) {
        const c = parseMatcher(m.raw);
        if (!c.ok) invalid.push(m.raw);
      }
    });
    if (invalid.length > 0) {
      return t.exportDialog.selfCheckInvalidMatchers(
        invalid.length,
        invalid.slice(0, 3).join(', ') + (invalid.length > 3 ? ' …' : ''),
      );
    }
    return null;
  }, [routeYaml, root, t]);

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text);
      onToast(t.exportDialog.copied);
    } catch {
      onToast(t.exportDialog.copyFailed);
    }
  };

  const download = (): void => {
    const blob = new Blob([text], { type: 'text/yaml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download =
      tab === 'route' ? 'route.yaml' : tab === 'file' ? 'alertmanager_config.yaml' : 'route.diff';
    a.click();
    URL.revokeObjectURL(url);
    onToast(t.exportDialog.saved);
  };

  return (
    <Modal
      title={t.exportDialog.title}
      onClose={onClose}
      footer={
        <>
          <span className="hint" style={{ marginRight: 'auto' }}>
            {t.exportDialog.size(text.split('\n').length, new Blob([text]).size)}
          </span>
          <button type="button" className="btn" onClick={download}>
            {t.exportDialog.download}
          </button>
          <button type="button" className="btn primary" onClick={copy}>
            {t.exportDialog.copy}
          </button>
        </>
      }
    >
      <div className="modal-body">
        <div className="segmented" style={{ alignSelf: 'flex-start' }}>
          <button
            type="button"
            className={tab === 'route' ? 'active' : ''}
            onClick={() => setTab('route')}
          >
            {t.exportDialog.tabRoute}
          </button>
          <button
            type="button"
            className={tab === 'file' ? 'active' : ''}
            disabled={!canSpliceFile}
            title={
              fromApi
                ? t.exportDialog.tabFileDisabledApi
                : canSpliceFile
                  ? t.exportDialog.tabFileTitle
                  : t.exportDialog.tabFileNeedsWholeFile
            }
            onClick={() => setTab('file')}
          >
            {t.exportDialog.tabFile}
          </button>
          <button
            type="button"
            className={tab === 'diff' ? 'active' : ''}
            title={t.exportDialog.tabDiffTitle}
            onClick={() => setTab('diff')}
          >
            {t.exportDialog.tabDiff}{' '}
            {diff.changed ? `(+${diff.added} −${diff.removed})` : t.exportDialog.tabDiffNone}
          </button>
        </div>

        <span className="hint">
          <Rich
            text={
              tab === 'diff'
                ? t.exportDialog.hintDiff
                : tab === 'route'
                  ? t.exportDialog.hintRoute
                  : t.exportDialog.hintFile
            }
          />
        </span>

        {fromApi && tab === 'route' && (
          <div className="hint">
            <Rich text={t.exportDialog.apiSecretsNote} />
          </div>
        )}

        {selfCheck && <div className="load-error">{selfCheck}</div>}

        {tab === 'diff' ? (
          diff.changed ? (
            <div className="diff-box">
              {diffGroups.map((group, gi) => (
                <div className="diff-group" key={gi}>
                  {gi > 0 && <div className="diff-gap">⋯</div>}
                  {group.map((l, li) => (
                    <div className={`diff-line ${l.op}`} key={`${gi}-${li}`}>
                      <span className="diff-gutter">{l.baseLine ?? ''}</span>
                      <span className="diff-gutter">{l.nextLine ?? ''}</span>
                      <span className="diff-sign">
                        {l.op === 'add' ? '+' : l.op === 'del' ? '−' : ' '}
                      </span>
                      <span className="diff-text">{l.text || ' '}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ) : (
            <div className="hint">{t.exportDialog.noChanges}</div>
          )
        ) : (
          <pre>{text}</pre>
        )}
      </div>
    </Modal>
  );
}
