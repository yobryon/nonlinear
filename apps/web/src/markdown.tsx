import { useMemo } from 'react';
import { marked } from 'marked';

marked.setOptions({ gfm: true, breaks: true, async: false });

/**
 * Render markdown safely: raw HTML in the source is escaped before parsing,
 * so only marked-generated markup reaches the DOM.
 */
export function Markdown({ source }: { source: string }) {
  const html = useMemo(() => {
    const escaped = source.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return marked.parse(escaped) as string;
  }, [source]);
  if (!source.trim()) return null;
  return <div className="md" dangerouslySetInnerHTML={{ __html: html }} />;
}
