import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { MermaidDiagram, SidebarMarkdown, mermaidFrameDocument } from '../sidebar-markdown.js';

const render = (text: string) => renderToStaticMarkup(createElement(SidebarMarkdown, { children: text, hideImages: true }));

it.each([
  ['Keep **this** now.', 1, 9, 11, '<strong>t<mark class="question-highlight">hi</mark>s</strong>'],
  ['A &amp; B', 1, 3, 8, '<mark class="question-highlight">&amp;</mark>'],
  ['one\r\n\r\n**😀 ok**', 3, 3, 5, '<strong><mark class="question-highlight">😀</mark> ok</strong>'],
  ['A\tB', 1, 3, 4, '<mark class="question-highlight">B</mark>'],
  ['Use `code`.', 1, 6, 10, '<code><mark class="question-highlight">code</mark></code>'],
  ['- first\n  next **word**', 2, 10, 14, '<strong><mark class="question-highlight">word</mark></strong>'],
  ['<details><summary>One &amp; two</summary></details>', 1, 23, 28, '<mark class="question-highlight">&amp;</mark>'],
  ['A \\* B', 1, 3, 5, '<mark class="question-highlight">*</mark>'],
  ['| One | Two |\n| --- | --- |\n| A | B |', 3, 7, 8, '<td><mark class="question-highlight">B</mark></td>'],
  ['<details>\n<summary>Section</summary>\n\n**Focus** here.\n\n</details>', 4, 3, 8, '<strong><mark class="question-highlight">Focus</mark></strong>'],
] as const)('highlights exact source positions without losing Markdown structure: %s', (source, line, start, end, expected) => {
  const html = renderToStaticMarkup(createElement(SidebarMarkdown, { children: source, hideImages: true, highlights: [{ element: 'app', start: { line, column: start }, end: { line, column: end } }] }));
  expect(html).toContain(expected);
});

it('merges overlapping ranges, leaves URLs and Mermaid source alone, and cannot restore stripped HTML', () => {
  const source = 'Draft now. [link](https://example.com)\n\n<script>bad()</script>\n\n```mermaid\nflowchart LR\n A --> B\n```';
  const highlights = [{ element: 'app', start: { line: 1, column: 1 }, end: { line: 1, column: 5 } }, { element: 'app', start: { line: 1, column: 3 }, end: { line: 8, column: 4 } }];
  const html = renderToStaticMarkup(createElement(SidebarMarkdown, { children: source, hideImages: true, highlights }));
  expect(html).toContain('<mark class="question-highlight">Draft now. </mark>');
  expect(html).toContain('href="https://example.com"');
  expect(html).toContain('<iframe');
  expect(html).not.toContain('Diagram source');
  expect(html).not.toContain('bad()');
  expect(html).not.toContain('<script');
});

it('links shared passages through one counted picker and reserves a table gutter', () => {
  const questions = ['first', 'second'].map(id => ({ id, target: { type: 'node' as const, id: 'app' }, question: `${id} question`, proposal: 'Proposal', recommendation: 'Recommendation' }));
  const source = 'Shared text.\n\n| Name |\n| --- |\n| Value |';
  const highlights = questions.flatMap(question => [
    { element: 'app', questionId: question.id, start: { line: 1, column: 1 }, end: { line: 1, column: 7 } },
    { element: 'app', questionId: question.id, start: { line: 5, column: 3 }, end: { line: 5, column: 8 } },
  ]);
  const html = renderToStaticMarkup(createElement(SidebarMarkdown, { children: source, highlights, navigation: { questions, onQuestion: () => {} } }));
  expect(html.match(/aria-label="View questions \(2\)"/g)).toHaveLength(2);
  expect(html).toContain('question-reference-cell');
  expect(html).toContain('markdown-table question-table');
  expect(html).toContain('dropdown-trigger');
  expect(html).not.toContain('<select');
  const overlap = renderToStaticMarkup(createElement(SidebarMarkdown, { children: 'abcdefghij', highlights: [
    { element: 'app', questionId: 'first', start: { line: 1, column: 1 }, end: { line: 1, column: 7 } },
    { element: 'app', questionId: 'second', start: { line: 1, column: 4 }, end: { line: 1, column: 10 } },
  ] }));
  expect(overlap).toContain('data-question-ids="first">abc</mark>');
  expect(overlap).toContain('data-question-ids="first second">def</mark>');
  expect(overlap).toContain('data-question-ids="second">ghi</mark>');
});

it('does not expose diagram source in the ordinary preview', () => {
  const html = render('```mermaid\nflowchart LR\nA --> B\n```');
  expect(html).toContain('<iframe');
  expect(html).not.toContain('Diagram source');
  const tooLarge = render(`\`\`\`mermaid\n${'x'.repeat(50_001)}\n\`\`\``);
  expect(tooLarge).toContain('Diagram source');
  expect(tooLarge).toContain('rendering limit');
});

it('renders tables with formatted cells rather than literal pipes', () => {
  const html = render('| Table | Owns |\n| --- | --- |\n| `agent_runs` | **Execution** |');
  expect(html).toContain('<table>');
  expect(html).toContain('<th>Table</th>');
  expect(html).toContain('<td><code>agent_runs</code></td>');
  expect(html).toContain('<strong>Execution</strong>');
});

it('renders Markdown inside nested native collapsible sections', () => {
  const html = render('<details open>\n<summary>Storage</summary>\n\n## Schema\n\n<details>\n<summary>Fields</summary>\n\n| Field | Type |\n| --- | --- |\n| id | UUID |\n\n</details>\n\n</details>');
  expect(html.match(/<details/g)).toHaveLength(2);
  expect(html).toContain('<details open="">');
  expect(html).toContain('<summary>Storage</summary>');
  expect(html).toContain('<h2>Schema</h2>');
  expect(html).toContain('<td>UUID</td>');
});

it('keeps scripts, embedded documents, handlers, styles, and images out of design prose', () => {
  const html = render('<script>alert(1)</script>\n<iframe src="https://example.com"></iframe>\n<details onclick="alert(1)" style="background:url(https://example.com)"><summary>Safe</summary></details>\n\n[bad](javascript:alert(1))\n\n<img src="https://example.com/x" onerror="alert(1)">\n\n![image](https://example.com/x)');
  expect(html).toContain('<summary>Safe</summary>');
  for (const forbidden of ['<script', '<iframe', 'onclick', 'onerror', 'style=', 'javascript:', '<img']) expect(html).not.toContain(forbidden);
});

it('renders Mermaid fences in isolated frames with escaped source', () => {
  const html = render('```mermaid\nflowchart LR\n A["</script><script>parent.untrustedRan=true</script>"] --> B\n```');
  expect(html).toContain('<iframe');
  expect(html).toContain('sandbox="allow-scripts"');
  expect(html).not.toContain('allow-same-origin');
  expect(html).not.toContain('srcDoc=');
  const document = mermaidFrameDocument('</script><script>parent.untrustedRan=true</script>');
  expect(document).toContain('Content-Security-Policy');
  expect(document).toContain("default-src 'none'");
  expect(document).toContain('\\u003c/script');
  expect(document).not.toContain('</script><script>parent.untrustedRan');
  expect(html).not.toContain('<summary>Diagram source</summary>');
});

it('does not start Mermaid for oversized source', () => {
  const html = renderToStaticMarkup(createElement(MermaidDiagram, { source: 'a'.repeat(50_001) }));
  expect(html).toContain('role="alert"');
  expect(html).not.toContain('<iframe');
});

it('leaves ordinary code fences intact', () => {
  expect(render('```sql\nselect * from agent_runs;\n```')).toContain('<pre><code class="language-sql">select * from agent_runs;');
});
