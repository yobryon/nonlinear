import { useMemo } from 'react';
import { marked } from 'marked';

marked.setOptions({ gfm: true, breaks: true, async: false });

/**
 * Render markdown safely: neutralize raw HTML by escaping `&` and `<` before
 * parsing, so a literal tag like `<img onerror>` becomes text and only
 * marked-generated markup reaches the DOM. `>` is deliberately left intact — a
 * lone `>` can't open an HTML tag, and escaping it would break blockquotes.
 */
export function Markdown({ source }: { source: string }) {
  const html = useMemo(() => {
    const escaped = source.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    return marked.parse(escaped) as string;
  }, [source]);
  if (!source.trim()) return null;
  return <div className="md" dangerouslySetInnerHTML={{ __html: html }} />;
}
