import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { SidebarMarkdown } from '../sidebar-markdown.js';

const render = (text: string, design = true) => renderToStaticMarkup(createElement(SidebarMarkdown, { children: text, hideImages: design, foldHeadings: design }));

it('leaves the synthesis visible and closes heading sections without changing their content', () => {
  const html = render('The proposal and its blocker.\n\n## Approach\n\nSupporting explanation.\n\n## Limits\n\nConversion stays blocked.');
  expect(html).toMatch(/^<p>The proposal and its blocker\.<\/p>\s*<details/);
  expect(html).toContain('<summary><h2>Approach</h2></summary>');
  expect(html).toMatch(/Supporting explanation\.<\/p>\s*<\/details><details[^>]*><summary><h2>Limits/);
  expect(html.match(/<details\b/g)).toHaveLength(2);
  expect(html).not.toMatch(/<details[^>]*\bopen/);
  expect(html).toContain('Conversion stays blocked.');
});

it('nests subsections under their actual parent, including skipped levels and repeated headings', () => {
  const html = render('# Proposal\n\nParent text.\n\n### Evidence\n\nEvidence text.\n\n###### Limit\n\nLimit text.\n\n### Evidence\n\nOther evidence.\n\n# Alternative\n\nAlternative text.');
  expect(html.match(/<details\b/g)).toHaveLength(5);
  expect(html).toMatch(/Parent text\.<\/p>\s*<details[^>]*><summary><h3>Evidence/);
  expect(html).toMatch(/Evidence text\.<\/p>\s*<details[^>]*><summary><h6>Limit/);
  expect(html).toMatch(/Limit text\.<\/p>\s*<\/details><\/details><details[^>]*><summary><h3>Evidence/);
  expect(html).toMatch(/Other evidence\.<\/p>\s*<\/details><\/details><details[^>]*><summary><h1>Alternative/);
});

it('preserves heading markup, GFM tables, lists, code, and HTML safety within folded sections', () => {
  const html = render('## **Decision**\n\n- One\n- Two\n\n| Choice | Status |\n| --- | --- |\n| Native | Blocked |\n\n```md\n## Not a section\n```\n\n<script>alert(1)</script>\n\n![hidden](https://example.com/image.png)');
  expect(html).toContain('<summary><h2><strong>Decision</strong></h2></summary>');
  expect(html).toContain('<li>One</li>');
  expect(html).toContain('<table>');
  expect(html).toContain('<th>Choice</th>');
  expect(html).toContain('tabindex="0"');
  expect(html.match(/<details\b/g)).toHaveLength(1);
  expect(html).toContain('## Not a section');
  expect(html).not.toContain('<script>');
  expect(html).not.toContain('<img');
});

it('retains the exact text sequence used by saved quote anchors', () => {
  const source = 'Summary.\n\n## Repeat 😀\n\nBefore **same quote** after.\n\n### Repeat 😀\n\nAnother same quote.';
  const text = (html: string) => html.replace(/<[^>]*>/g, '');
  expect(text(render(source))).toBe(text(render(source, false)));
});

it('preserves source-position highlights and question navigation inside folded subsections', () => {
  const source = '## Heading\n\n### Inner\n\n**Focus** here.';
  const html = renderToStaticMarkup(createElement(SidebarMarkdown, {
    children: source, foldHeadings: true,
    highlights: [{ element: 'app', questionId: 'q1', start: { line: 5, column: 3 }, end: { line: 5, column: 8 } }],
    navigation: { questions: [{ id: 'q1', target: { type: 'node', id: 'app' }, question: 'Clarify focus?' }], onQuestion: () => {} },
  }));
  expect(html.match(/<details\b/g)).toHaveLength(2);
  expect(html).toContain('<strong><mark class="question-highlight" data-question-ids="q1">Focus</mark></strong>');
  expect(html).toContain('aria-label="View question: Clarify focus?"');
});

it('keeps non-design Markdown and heading-free prose unchanged', () => {
  expect(render('## Existing definition\n\nExplanation.', false)).toContain('<h2>Existing definition</h2>');
  expect(render('## Existing definition\n\nExplanation.', false)).not.toContain('<details');
  expect(render('Plain explanation.')).toBe('<p>Plain explanation.</p>');
  expect(render('')).toBe('');
  expect(render('> ## Quoted heading\n>\n> Quoted text.')).not.toContain('<details');
});
