/**
 * Viewer for the ORIGINAL paste, for cross-checking. This text is never changed by
 * anything the editor does. By default only the `route:` block is shown, so that
 * secrets from `receivers:` are not put on screen without being asked for.
 */

import { useState } from 'react';
import { Rich } from '../i18n/Rich';
import { useT } from '../i18n/react';
import type { LoadedSource } from '../state/store';
import { Modal } from './Modal';

export function SourceDialog({
  source,
  onClose,
}: {
  source: LoadedSource;
  onClose: () => void;
}): React.JSX.Element {
  const t = useT();
  const [showAll, setShowAll] = useState(!source.routeBlock);
  const lines = source.text.replace(/\r\n?/g, '\n').split('\n');
  const shown =
    showAll || !source.routeBlock
      ? source.text
      : lines.slice(source.routeBlock.start, source.routeBlock.end).join('\n');

  return (
    <Modal
      title={t.sourceDialog.title}
      onClose={onClose}
      footer={
        <button type="button" className="btn" onClick={onClose}>
          {t.common.close}
        </button>
      }
    >
      <div className="modal-body">
        <span className="hint">
          <Rich text={t.sourceDialog.intro(lines.length)} />
          {source.origin === 'api' && (
            <>
              {' '}
              <Rich text={t.sourceDialog.fromApi(source.originUrl ?? '')} />
            </>
          )}
        </span>
        {source.routeBlock && (
          <label className="chk">
            <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
            <Rich text={t.sourceDialog.showWholeFile} />
          </label>
        )}
        <pre>{shown}</pre>
      </div>
    </Modal>
  );
}
