import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { captureQuoteAnchor, hitPostedRanges, resolvePostedRanges } from '../quote-anchors.js';
import type { Annotation } from '../pack.js';

// A small DOM boundary fixture: offsets are UTF-16, as in browser Text and Range.
class Host {
  nodeType = 1;
  dataset = { annotateType: 'node', annotateId: 'n' };
  nodes: Leaf[] = [];
  constructor(public excluded = false) {}
  closest(selector: string) { return selector.startsWith('[data-annotate') ? this : this.excluded ? this : null; }
  contains(node: unknown) { return this.nodes.includes(node as Leaf); }
}
class Leaf {
  nodeType = 3;
  isConnected = true;
  constructor(public textContent: string, public parentElement: Host) { parentElement.nodes.push(this); }
  get length() { return this.textContent.length; }
}
class SourceRange {
  startContainer!: Leaf;
  endContainer!: Leaf;
  startOffset = 0;
  endOffset = 0;
  setStart(node: Leaf, offset: number) { this.startContainer = node; this.startOffset = offset; }
  setEnd(node: Leaf, offset: number) { this.endContainer = node; this.endOffset = offset; }
  point(node: Leaf, offset: number) {
    const nodes = node.parentElement.nodes;
    return nodes.slice(0, nodes.indexOf(node)).reduce((sum, part) => sum + part.length, 0) + offset;
  }
  comparePoint(node: Leaf, offset: number) {
    const point = this.point(node, offset);
    return point < this.point(this.startContainer, this.startOffset) ? -1 : point > this.point(this.endContainer, this.endOffset) ? 1 : 0;
  }
  toString() {
    return this.startContainer.parentElement.nodes.map(node => node.textContent).join('').slice(this.point(this.startContainer, this.startOffset), this.point(this.endContainer, this.endOffset));
  }
  getClientRects() { return [{ left: 10, right: 40, top: 10, bottom: 20, width: 30, height: 10 }, { left: 10, right: 20, top: 30, bottom: 40, width: 10, height: 10 }]; }
}
let hosts: Host[];
const annotation = (selectedText = '😀 multi node'): Annotation => ({ id: 'a', packVersion: 'v1', target: { type: 'node', id: 'n' }, selectedText, comment: 'Read this' });
beforeEach(() => {
  hosts = [];
  vi.stubGlobal('NodeFilter', { SHOW_TEXT: 4 });
  vi.stubGlobal('document', {
    querySelectorAll: () => hosts,
    createRange: () => new SourceRange(),
    createTreeWalker: (host: Host) => { let index = 0; return { nextNode: () => host.nodes[index++] }; },
  });
});
afterEach(() => vi.unstubAllGlobals());
function host(parts: string[], excluded = false, id = 'n') {
  const element = new Host(excluded);
  element.dataset.annotateId = id;
  parts.forEach(text => new Leaf(text, element));
  hosts.push(element);
  return element;
}
it('captures a trimmed multi-node Unicode range and reconstructs it after a reload', () => {
  const before = host(['Before  😀 multi', ' node  after']);
  const range = new SourceRange();
  range.setStart(before.nodes[0], 6);
  range.setEnd(before.nodes[1], 7);
  const anchor = captureQuoteAnchor(range as unknown as Range, annotation().target, '😀 multi node');
  expect(anchor).toEqual({ prefix: 'Before  ', suffix: '  after' });
  hosts = [];
  const reloaded = host(['Before  😀 ', 'multi ', 'node  after']);
  const [resolved] = resolvePostedRanges([{ ...annotation(), quoteAnchor: anchor }]);
  expect(resolved.range.startContainer).toBe(reloaded.nodes[0]);
  expect(resolved.range.startOffset).toBe(8);
  expect(resolved.range.endContainer).toBe(reloaded.nodes[2]);
  expect(resolved.range.endOffset).toBe(4);
  expect(resolved.range.toString()).toBe('😀 multi node');
});
it('does not capture adjacent text nodes that only touch selection boundaries', () => {
  const element = host(['Before ', 'quote', ' after']);
  const range = new SourceRange();
  range.setStart(element.nodes[1], 0);
  range.setEnd(element.nodes[1], 5);
  expect(captureQuoteAnchor(range as unknown as Range, annotation().target, 'quote')).toEqual({ prefix: 'Before ', suffix: ' after' });
});
it('scopes targets, excludes measurement/UI hosts, and accepts legitimate card/drawer copies', () => {
  host(['😀 multi node']);
  host(['😀 multi node']);
  host(['😀 multi node'], true);
  host(['😀 multi node'], false, 'other');
  const wrongType = host(['😀 multi node']);
  wrongType.dataset.annotateType = 'group';
  expect(resolvePostedRanges([annotation()])).toHaveLength(2);
  expect(resolvePostedRanges([])).toEqual([]);
  const cross = new SourceRange();
  cross.setStart(hosts[0].nodes[0], 0);
  cross.setEnd(hosts[1].nodes[0], 3);
  expect(captureQuoteAnchor(cross as unknown as Range, annotation().target, '😀')).toBeUndefined();
});
it('does not retain a quote when React reuses identical text for a different target id or type', () => {
  const element = host(['same quote']);
  expect(resolvePostedRanges([annotation('same quote')])).toHaveLength(1);
  element.dataset.annotateId = 'different';
  expect(resolvePostedRanges([annotation('same quote')])).toEqual([]);
  element.dataset.annotateId = 'n';
  element.dataset.annotateType = 'group';
  expect(resolvePostedRanges([annotation('same quote')])).toEqual([]);
});
it('keeps authored header-select labels eligible while excluding ordinary button text', () => {
  const element = host([]);
  const header = new Host();
  header.closest = (selector: string) => selector.startsWith('[data-annotate') ? element : selector.includes('button:not(.header-select)') ? null : header;
  const label = new Leaf('Architecture label', header);
  const control = new Host(true);
  control.closest = (selector: string) => selector.startsWith('[data-annotate') ? element : control;
  const action = new Leaf('Add a comment', control);
  element.nodes.push(label, action);
  expect(resolvePostedRanges([annotation('Architecture label')])).toHaveLength(1);
  expect(resolvePostedRanges([annotation('Add a comment')])).toEqual([]);
});
it('leaves repeated, stale, and malformed anchors unmarked instead of choosing the wrong occurrence', () => {
  host(['same same']);
  expect(resolvePostedRanges([annotation('same')])).toEqual([]);
  expect(resolvePostedRanges([{ ...annotation('same'), quoteAnchor: { prefix: 'same ', suffix: '' } }])).toHaveLength(1);
  expect(resolvePostedRanges([{ ...annotation('same'), quoteAnchor: { prefix: 'missing', suffix: '' } }])).toEqual([]);
  expect(resolvePostedRanges([{ ...annotation('same'), quoteAnchor: null }])).toEqual([]);
});
it('hit-tests actual line rectangles, retains overlapping comments, and ignores disconnected sources', () => {
  const element = host(['😀 multi node']);
  const ranges = resolvePostedRanges([annotation(), { ...annotation('multi'), id: 'b' }]);
  expect(hitPostedRanges(ranges, 15, 15).map(hit => hit.annotation.id)).toEqual(['a', 'b']);
  expect(hitPostedRanges(ranges, 30, 35)).toEqual([]);
  expect(hitPostedRanges(ranges, 15, 25)).toEqual([]);
  element.nodes[0].isConnected = false;
  expect(hitPostedRanges(ranges, 15, 15)).toEqual([]);
});
