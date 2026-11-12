// Generated diagram blocks: the marker-wrapped mermaid that older map tooling
// wrote into node bodies (ADR 0014). ACStack no longer draws them, but node
// bodies and design docs may still hold them, so readers strip them here.
import type { NodeKind, NodeMode, NodeStatus } from './nodes.js';

/**
 * A node as a tracker backend hands it over. `url` is where the two backends
 * differ: an issue has one and a file on disk does not.
 */
export interface DiagramNode {
  id: string;
  title: string;
  status: NodeStatus;
  mode: NodeMode;
  kind: NodeKind;
  label: string;
  answers?: string;
  blockedBy: string[];
  pinned: boolean;
  url?: string;
}

// The markers bound a generated block, so stripping it never touches prose a
// human wrote around it.
export const DIAGRAM_START = '<!-- acstack:diagram -->';
export const DIAGRAM_END = '<!-- /acstack:diagram -->';

/** A fenced code block's opening run, as the line that closes it has to match. */
interface Fence {
  char: string;
  length: number;
}

// A fence opens on three or more backticks or tildes, indented at most three
// spaces. It closes on a run of the same character, at least as long, with
// nothing after it.
const FENCE_LINE = /^ {0,3}(`{3,}|~{3,})(.*)$/;

/** The fence still open after this line, given the one open before it. */
function fenceAfter(line: string, open: Fence | undefined): Fence | undefined {
  const match = FENCE_LINE.exec(line);
  if (!match) return open;
  const run: Fence = { char: match[1][0], length: match[1].length };
  if (!open) return run;
  const closes = run.char === open.char && run.length >= open.length && match[2].trim() === '';
  return closes ? undefined : open;
}

function isBlank(line: string): boolean {
  return line.trim() === '';
}

/** True when the line holds `marker` and nothing else but whitespace. */
function isMarkerLine(line: string, marker: string): boolean {
  return line.trim() === marker;
}

/** The first line from `from` onwards that is `marker` alone, or -1 when none is. */
function findFrom(lines: string[], from: number, marker: string): number {
  for (let at = from; at < lines.length; at++) {
    if (isMarkerLine(lines[at], marker)) return at;
  }
  return -1;
}

/**
 * The first and last line of every complete block, or undefined when a start
 * marker has no end marker after it.
 */
function diagramSpans(lines: string[]): Array<[number, number]> | undefined {
  const spans: Array<[number, number]> = [];
  let fence: Fence | undefined;
  let at = 0;
  while (at < lines.length) {
    const line = lines[at];
    if (fence !== undefined || !isMarkerLine(line, DIAGRAM_START)) {
      fence = fenceAfter(line, fence);
      at++;
      continue;
    }
    const end = findFrom(lines, at + 1, DIAGRAM_END);
    if (end === -1) return undefined;
    // A start marker that a later start marker outruns opened nothing: the end
    // marker below belongs to the later start. Abandon the first one and open
    // the block at the later marker, so the prose in between survives.
    const nextStart = findFrom(lines, at + 1, DIAGRAM_START);
    if (nextStart !== -1 && nextStart <= end) {
      at = nextStart;
      continue;
    }
    spans.push([at, end]);
    at = end + 1;
  }
  return spans;
}

/** Every line outside the spans, with the seam each removal leaves tidied. */
function withoutSpans(lines: string[], spans: Array<[number, number]>): string[] {
  const kept: string[] = [];
  let at = 0;
  for (const [start, end] of spans) {
    for (; at < start; at++) kept.push(lines[at]);
    at = end + 1;
    // Removing a block leaves the blank line above it against the blank line
    // below. Drop both runs, then put back the single blank line that separates
    // the prose the block sat between. A block at either end of the text has
    // prose on one side only, so nothing goes back.
    while (kept.length > 0 && isBlank(kept[kept.length - 1])) kept.pop();
    while (at < lines.length && isBlank(lines[at])) at++;
    if (kept.length > 0 && at < lines.length) kept.push('');
  }
  for (; at < lines.length; at++) kept.push(lines[at]);
  return kept;
}

/**
 * The same text with every marker-bounded generated block removed.
 *
 * It lives beside the markers it strips, rather than in nodes.ts where the
 * readers of it sit, because this module already imports nodes.ts and a helper
 * there needing the markers would close an import cycle.
 *
 * Five rules decide what counts as a block, and what removing one leaves.
 *
 * A marker counts only when its own line holds nothing else, whatever
 * whitespace sits around it. The generator always wrote each marker alone on
 * its line, so a sentence that mentions a marker is prose and opens nothing.
 *
 * A marker inside a fenced code block is prose about the markers rather than a
 * block, so a node body documenting them keeps its fence whole.
 *
 * An end marker pairs with the last start marker before it. A start marker that
 * a second start marker reaches first was prose too, and every line between the
 * two survives.
 *
 * A start marker with no end marker after it leaves the text completely
 * unchanged. Without a closing boundary there is no trustworthy end, and
 * cutting to the end of the text would take a human's prose with it.
 *
 * The blank-line cleanup runs at the seam a removal leaves, and nowhere else.
 * Blank lines the rest of the text holds survive, three in a row inside a
 * python fence included.
 */
export function stripDiagrams(text: string): string {
  // The final newline is the end of the last line, not a line of its own, and
  // splitting on it would hand the seam an empty line that is not blank space.
  const trailingNewline = text.endsWith('\n');
  const lines = (trailingNewline ? text.slice(0, -1) : text).split('\n');
  const spans = diagramSpans(lines);
  if (spans === undefined || spans.length === 0) return text;
  return withoutSpans(lines, spans).join('\n') + (trailingNewline ? '\n' : '');
}
