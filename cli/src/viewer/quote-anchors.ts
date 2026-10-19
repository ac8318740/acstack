import type { ReviewAnnotation } from '../lib/alignment-packs.js';
import type { Annotation } from './pack.js';

export type QuoteAnchor = { prefix: string; suffix: string };

export function toReviewAnnotation(annotation: Annotation): ReviewAnnotation {
  const { packVersion, target, selectedText, sourceRef, comment, author, time } = annotation;
  return { packVersion, target: { type: target.type, id: target.id }, selectedText, sourceRef, comment, author, time };
}

export function quoteOffsets(text: string, quote: string, anchor?: unknown): number[] {
  if (!quote) return [];
  let context: QuoteAnchor | undefined;
  if (anchor !== undefined) {
    if (!anchor || typeof anchor !== 'object' || !('prefix' in anchor) || !('suffix' in anchor)
      || typeof anchor.prefix !== 'string' || typeof anchor.suffix !== 'string'
      || anchor.prefix.length > 32 || anchor.suffix.length > 32) return [];
    context = { prefix: anchor.prefix, suffix: anchor.suffix };
  }
  const matches: number[] = [];
  for (let start = text.indexOf(quote); start !== -1; start = text.indexOf(quote, start + 1)) {
    if (!context || (text.slice(Math.max(0, start - context.prefix.length), start) === context.prefix
      && text.slice(start + quote.length, start + quote.length + context.suffix.length) === context.suffix)) matches.push(start);
  }
  return matches.length === 1 ? matches : [];
}

const excluded = '[inert], [hidden], [aria-hidden="true"], .measurement, .comments, .comment-form, .popover, .posted-comment-popover, .count-pill, .card-controls, form, button:not(.header-select), input, textarea, select, script, style';
const hostSelector = '[data-annotate-type][data-annotate-id]';
function hostText(host: HTMLElement) {
  const nodes: { node: Text; start: number; end: number }[] = [];
  let text = '';
  const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.parentElement?.closest(excluded) || node.parentElement?.closest(hostSelector) !== host) continue;
    const value = node.textContent ?? '';
    nodes.push({ node: node as Text, start: text.length, end: text.length + value.length });
    text += value;
  }
  return { text, nodes };
}

export function captureQuoteAnchor(range: Range, target: Annotation['target'], quote: string): QuoteAnchor | undefined {
  const element = range.startContainer.nodeType === 1 ? range.startContainer as Element : range.startContainer.parentElement;
  const host = element?.closest<HTMLElement>(hostSelector);
  if (!host || host.dataset.annotateType !== target.type || host.dataset.annotateId !== target.id
    || !host.contains(range.endContainer) || host.closest(excluded)) return;
  const { text, nodes } = hostText(host);
  let start: number | undefined;
  let end: number | undefined;
  for (const part of nodes) {
    const before = range.comparePoint(part.node, 0);
    const after = range.comparePoint(part.node, part.node.length);
    if (after < 0 || before > 0 || (before < 0 && range.startContainer !== part.node)
      || (after > 0 && range.endContainer !== part.node)) continue;
    const from = range.startContainer === part.node ? range.startOffset : 0;
    const to = range.endContainer === part.node ? range.endOffset : part.node.length;
    start ??= part.start + from;
    end = part.start + to;
  }
  if (start === undefined || end === undefined) return;
  const selected = text.slice(start, end);
  start += selected.length - selected.trimStart().length;
  end -= selected.length - selected.trimEnd().length;
  if (text.slice(start, end) !== quote) return;
  return { prefix: text.slice(Math.max(0, start - 32), start), suffix: text.slice(end, end + 32) };
}

export type PostedRange = { annotation: Annotation; range: Range };
export function resolvePostedRanges(annotations: Annotation[]): PostedRange[] {
  const result: PostedRange[] = [];
  for (const host of document.querySelectorAll<HTMLElement>(hostSelector)) {
    if (host.closest(excluded)) continue;
    const { text, nodes } = hostText(host);
    for (const annotation of annotations) {
      if (!annotation.selectedText || annotation.target.type !== host.dataset.annotateType || annotation.target.id !== host.dataset.annotateId) continue;
      for (const offset of quoteOffsets(text, annotation.selectedText, annotation.quoteAnchor)) {
        const end = offset + annotation.selectedText.length;
        const first = nodes.find(part => part.start <= offset && part.end > offset);
        const last = nodes.find(part => part.start < end && part.end >= end);
        if (!first || !last) continue;
        const range = document.createRange();
        range.setStart(first.node, offset - first.start);
        range.setEnd(last.node, end - last.start);
        if (range.toString() !== annotation.selectedText) continue;
        result.push({ annotation, range });
      }
    }
  }
  return result;
}

export function hitPostedRanges(ranges: PostedRange[], x: number, y: number): PostedRange[] {
  return ranges.filter(({ range }) => range.startContainer.isConnected && Array.from(range.getClientRects()).some(rect =>
    rect.width > 0 && rect.height > 0 && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom));
}
