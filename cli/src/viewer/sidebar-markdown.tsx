import { Children, isValidElement, useContext, useEffect, useRef, useState, type ComponentProps, type ContextType } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { markdownHighlights, type QuestionHighlight } from './markdown-highlights.js';
import { passageComponents, QuestionReferenceContext } from './question-reference.js';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';

declare const MERMAID_FRAME_JS: string;

const schema = {
  ...defaultSchema,
  tagNames: [...defaultSchema.tagNames!, 'details', 'summary'],
  attributes: { ...defaultSchema.attributes, details: ['open'] },
};

export function mermaidFrameDocument(source: string): string {
  // Authored text is data, never executable markup. The renderer cannot access the review token.
  const data = JSON.stringify(source).replaceAll('<', '\\u003c');
  const runtime = typeof MERMAID_FRAME_JS === 'undefined' ? '' : MERMAID_FRAME_JS.replace(/<\/script/gi, '<\\/script');
  return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:"><style>body{margin:8px;font:14px system-ui}svg{display:block;max-width:100%;height:auto;margin:0 auto}#diagram{overflow:auto}</style></head><body><div id="diagram" role="img" aria-label="Mermaid diagram">Rendering diagram...</div><script id="source" type="application/json">${data}</script><script>${runtime}</script></body></html>`;
}

// The frame's reported height, clamped so a hostile or broken frame cannot size the page.
export function mermaidHeight(data: unknown): number | undefined {
  const value = (data as { mermaidHeight?: unknown } | null)?.mermaidHeight;
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(4000, Math.max(80, Math.ceil(value))) : undefined;
}

export function MermaidDiagram({ source }: { source: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [visible, setVisible] = useState(false);
  const [height, setHeight] = useState<number>();
  useEffect(() => {
    // Only this frame's own window may size it, and only within sane bounds.
    const receive = (event: MessageEvent) => {
      const value = mermaidHeight(event.data);
      if (event.source === frame.current?.contentWindow && value !== undefined) setHeight(value);
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, []);
  useEffect(() => {
    // Mermaid measures SVG text incorrectly while an ancestor disclosure is closed.
    const observer = new ResizeObserver(entries => {
      if (entries.some(entry => entry.contentRect.width > 0)) {
        setVisible(true);
        observer.disconnect();
      }
    });
    if (frame.current) observer.observe(frame.current);
    return () => observer.disconnect();
  }, []);
  return <div className="mermaid-diagram">
    {source.length <= 50_000 ? <iframe ref={frame} title="Mermaid diagram" sandbox="allow-scripts" referrerPolicy="no-referrer" style={height ? { height } : undefined} srcDoc={visible ? mermaidFrameDocument(source) : undefined} /> : <><p role="alert">Mermaid diagram exceeds the 50,000-character rendering limit.</p><details><summary>Diagram source</summary><pre><code>{source}</code></pre></details></>}
  </div>;
}

function MarkdownTable({ children }: ComponentProps<'table'>) {
  const navigation = useContext(QuestionReferenceContext);
  return <div className={`markdown-table${navigation ? ' question-table' : ''}`}><table>{children}</table></div>;
}

function MarkdownPre({ children }: ComponentProps<'pre'>) {
  const child = Children.toArray(children)[0];
  if (isValidElement<{ className?: string; children?: string }>(child) && child.props.className === 'language-mermaid') return <MermaidDiagram source={String(child.props.children ?? '').trimEnd()} />;
  return <pre>{children}</pre>;
}
const noImage = () => null;

export function SidebarMarkdown({ children, hideImages = false, highlights = [], navigation = null }: { children: string; hideImages?: boolean; highlights?: QuestionHighlight[]; navigation?: ContextType<typeof QuestionReferenceContext> }) {
  return <QuestionReferenceContext.Provider value={navigation}><Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw, [rehypeSanitize, schema], [markdownHighlights, { source: children, highlights }]]} components={{
    ...passageComponents, ...(hideImages ? { img: noImage } : {}), table: MarkdownTable, pre: MarkdownPre,
  }}>{children}</Markdown></QuestionReferenceContext.Provider>;
}
