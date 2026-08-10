/**
 * Renders a dictionary string carrying two bits of inline markup:
 *   `code`     → <code>
 *   **strong** → <b>
 *
 * Why this exists: without it every sentence containing a `<code>` or a `<b>` would
 * have to be split into two or three dictionary keys, and a translator would be
 * handed fragments instead of sentences. One key per sentence keeps the meaning
 * intact and lets other languages reorder the words freely.
 *
 * Deliberately not a Markdown parser: these two forms are all the UI needs, and
 * anything richer would invite HTML into translation files.
 */

function withStrong(text: string, keyPrefix: string): React.ReactNode[] {
  return text.split('**').map((part, i) =>
    i % 2 === 1 ? <b key={`${keyPrefix}b${i}`}>{part}</b> : <span key={`${keyPrefix}s${i}`}>{part}</span>,
  );
}

export function Rich({ text }: { text: string }): React.JSX.Element {
  const parts = text.split('`');
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? <code key={`c${i}`}>{part}</code> : withStrong(part, `p${i}`),
      )}
    </>
  );
}
