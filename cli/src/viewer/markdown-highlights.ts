import type { Element, Root, Text } from 'hast';
import { decodeString } from 'micromark-util-decode-string';
import type { DesignHighlight } from '../lib/alignment-packs.js';
import { highlightOffsets } from '../lib/design-highlight.js';

export type QuestionHighlight = DesignHighlight & { questionId?: string };

export function revealHighlights(container: HTMLElement, questionId?: string): boolean {
  const marks = container.querySelectorAll<HTMLElement>(questionId ? `mark.question-highlight[data-question-ids~="${questionId}"]` : 'mark.question-highlight');
  for (const mark of marks) {
    for (let parent = mark.parentElement; parent && parent !== container; parent = parent.parentElement) {
      if (parent.tagName === 'DETAILS') (parent as HTMLDetailsElement).open = true;
    }
  }
  marks[0]?.scrollIntoView({ block: 'center' });
  return marks.length > 0;
}

// Run after sanitizing: only this plugin can create the highlight markup.
export function markdownHighlights({ source, highlights }: { source: string; highlights: QuestionHighlight[] }) {
  const ranges = highlights.map(highlight => ({ offsets: highlightOffsets(source, highlight), id: highlight.questionId }));
  return (tree: Root) => {
    if (!ranges.length) return;
    const split = (node: Text): (Text | Element)[] => {
      const start = node.position?.start.offset, end = node.position?.end.offset;
      if (start === undefined || end === undefined || !ranges.some(({ offsets: [a, b] }) => a < end && b > start)) return [node];
      const raw = source.slice(start, end);
      const parts: (Text | Element)[] = [];
      let index = 0, rendered = 0;
      const append = (value: string, marked: boolean, ids?: string) => {
        const last = parts.at(-1);
        if (marked && last?.type === 'element' && last.properties.dataQuestionIds === ids) (last.children[0] as Text).value += value;
        else if (!marked && last?.type === 'text') last.value += value;
        else parts.push(marked ? { type: 'element', tagName: 'mark', properties: { className: ['question-highlight'], ...(ids && { dataQuestionIds: ids }) }, children: [{ type: 'text', value }] } : { type: 'text', value });
      };
      while (index < raw.length && rendered < node.value.length) {
        const token = /^(?:&(?:#[xX][\da-fA-F]+|#\d+|[a-zA-Z][a-zA-Z\d]*);|\\[!-/:-@[-`{-~]|\r\n)/.exec(raw.slice(index, index + 64))?.[0];
        const decoded = token === '\r\n' ? '\n' : token ? decodeString(token) : '';
        const unit = decoded && node.value.startsWith(decoded, rendered) ? decoded : String.fromCodePoint(raw.codePointAt(index)!);
        const length = decoded && unit === decoded ? token!.length : unit.length;
        if (node.value.startsWith(unit, rendered)) {
          const matching = ranges.filter(({ offsets: [a, b] }) => a < start + index + length && b > start + index);
          append(unit, matching.length > 0, [...new Set(matching.flatMap(range => range.id ? [range.id] : []))].join(' ') || undefined);
          rendered += unit.length;
        }
        // Markdown removes structural indentation from some multiline text nodes.
        index += length;
      }
      if (rendered < node.value.length) append(node.value.slice(rendered), false);
      return parts;
    };
    const walk = (parent: Root | Element): Set<string> => {
      const ids = new Set<string>();
      for (let index = 0; index < parent.children.length; index++) {
        const child = parent.children[index];
        if (child.type === 'element' && child.tagName !== 'pre') for (const id of walk(child)) ids.add(id);
        else if (child.type === 'text') {
          const parts = split(child);
          for (const part of parts) if (part.type === 'element') for (const id of String(part.properties.dataQuestionIds ?? '').split(' ').filter(Boolean)) ids.add(id);
          parent.children.splice(index, 1, ...parts);
          index += parts.length - 1;
        }
      }
      if (parent.type === 'element' && /^(p|li|h[1-6]|tr)$/.test(parent.tagName) && ids.size) {
        parent.properties.dataQuestionIds = [...ids].join(' ');
        return new Set();
      }
      return ids;
    };
    walk(tree);
  };
}
