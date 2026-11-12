import { describe, it, expect } from 'vitest';
import { stripDiagrams, DIAGRAM_START, DIAGRAM_END } from './diagram.js';
// ---------------------------------------------------------------------------
// stripDiagrams
//
// The unit layer under the `node read` and `node walk` tests in
// cli/src/commands/node.test.ts. Those state what the two commands print; these
// state what the function does to one piece of text, marker by marker.
// ---------------------------------------------------------------------------

/** One generated block, in the marker-wrapped shape older map tooling wrote. */
function block(content = 'flowchart TD\n  n001["x"]'): string {
  return [DIAGRAM_START, '```mermaid', content, '```', DIAGRAM_END].join('\n');
}

describe('stripDiagrams', () => {
  it('leaves text holding no marker exactly as it is', () => {
    const text = 'Intro.\n\nSome prose.\n\n```mermaid\ngraph TD\n  A --> B\n```\n';
    expect(stripDiagrams(text)).toBe(text);
  });

  it('returns empty text unchanged', () => {
    expect(stripDiagrams('')).toBe('');
  });

  it('removes one complete block', () => {
    expect(stripDiagrams(`Intro.\n\n${block()}\n\nOutro.\n`)).toBe('Intro.\n\nOutro.\n');
  });

  it('removes both blocks when the text holds two', () => {
    const text = `Intro.\n\n${block()}\n\nMiddle.\n\n${block()}\n\nOutro.\n`;
    expect(stripDiagrams(text)).toBe('Intro.\n\nMiddle.\n\nOutro.\n');
  });

  it('leaves the text alone when a start marker has no end marker after it', () => {
    const text = `Intro.\n\n${DIAGRAM_START}\n\`\`\`mermaid\nflowchart TD\n\`\`\`\n\nOutro.\n`;
    expect(stripDiagrams(text)).toBe(text);
  });

  it('leaves a line carrying both markers alone, because neither sits alone on it', () => {
    // The generator never wrote the two markers on one line, so a human who
    // does is writing prose about them.
    const text = ['Intro.', '', `${DIAGRAM_START} ${DIAGRAM_END}`, '', 'Outro.', ''].join('\n');
    expect(stripDiagrams(text)).toBe(text);
  });

  it('leaves a mentioned start marker and the lone end marker below it alone', () => {
    // No start marker sits alone on its line, so there is no block to close and
    // the end marker below belongs to nothing. Pairing the mention with it
    // would take both paragraphs in between.
    const text = [
      `We write it between ${DIAGRAM_START} and its closing twin.`,
      '',
      'KEEP THIS PARAGRAPH.',
      '',
      DIAGRAM_END,
      '',
      'AFTER.',
      '',
    ].join('\n');
    expect(stripDiagrams(text)).toBe(text);
  });

  it.each([
    ['a trailing space', `${DIAGRAM_START} `],
    ['four spaces of indent', `    ${DIAGRAM_START}`],
  ])('counts a start marker written with %s, since the line holds nothing else', (_name, start) => {
    const text = [
      'Intro.',
      '',
      start,
      '```mermaid',
      'flowchart TD',
      '```',
      DIAGRAM_END,
      '',
      'Outro.',
      '',
    ].join('\n');
    expect(stripDiagrams(text)).toBe('Intro.\n\nOutro.\n');
  });

  it.each([
    [
      'nothing after it',
      ['Intro.', '', `See ${DIAGRAM_START} above.`, ''],
      ['Intro.', '', `See ${DIAGRAM_START} above.`, ''],
    ],
    [
      'a lone end marker after it',
      ['Intro.', '', `See ${DIAGRAM_START} above.`, '', DIAGRAM_END, '', 'AFTER.', ''],
      ['Intro.', '', `See ${DIAGRAM_START} above.`, '', DIAGRAM_END, '', 'AFTER.', ''],
    ],
    [
      'a real block after it',
      ['Intro.', '', `See ${DIAGRAM_START} above.`, '', block(), '', 'AFTER.', ''],
      ['Intro.', '', `See ${DIAGRAM_START} above.`, '', 'AFTER.', ''],
    ],
  ] as const)('never opens a block on a line that mentions a marker, with %s', (_name, lines, want) => {
    expect(stripDiagrams(lines.join('\n'))).toBe(want.join('\n'));
  });

  it('leaves markers alone inside a fenced code block', () => {
    const text = [
      'Intro.',
      '',
      '```markdown',
      DIAGRAM_START,
      DIAGRAM_END,
      '```',
      '',
      'Outro.',
      '',
    ].join('\n');
    expect(stripDiagrams(text)).toBe(text);
  });

  it('leaves markers alone inside a four-backtick fence wrapping a three-backtick one', () => {
    const text = [
      'Intro documenting the markers.',
      '',
      '````markdown',
      DIAGRAM_START,
      '',
      '```mermaid',
      'flowchart TD',
      '```',
      '',
      DIAGRAM_END,
      '````',
      '',
      'Outro.',
      '',
    ].join('\n');
    expect(stripDiagrams(text)).toBe(text);
  });

  it('abandons a start marker that a later start marker outruns', () => {
    // The first marker sits in a sentence about the markers, so it opens
    // nothing. Pairing it with the end marker below would take both paragraphs
    // in between with it.
    const text = [
      `A generated block opens with ${DIAGRAM_START} on its own line.`,
      '',
      'PROSE THE HUMAN WROTE.',
      '',
      block(),
      '',
      'MORE PROSE AFTER.',
      '',
    ].join('\n');
    expect(stripDiagrams(text)).toBe(
      `A generated block opens with ${DIAGRAM_START} on its own line.\n\n` +
        'PROSE THE HUMAN WROTE.\n\nMORE PROSE AFTER.\n'
    );
  });

  it('pairs an end marker with the last start marker before it, so an earlier start was prose', () => {
    // Both start markers sit alone on their own line and outside any fence, so
    // the alone-on-its-line rule and the fence rule pass them both. Only the
    // pairing rule tells the stray marker above from the block below.
    const text = [
      'Intro.',
      '',
      DIAGRAM_START,
      '',
      'PROSE BETWEEN TWO STARTS.',
      '',
      block(),
      '',
      'Outro.',
      '',
    ].join('\n');
    // The abandoned marker line is prose like every other line the human left,
    // so it stays where they wrote it.
    expect(stripDiagrams(text)).toBe(
      ['Intro.', '', DIAGRAM_START, '', 'PROSE BETWEEN TWO STARTS.', '', 'Outro.', ''].join('\n')
    );
  });

  it('leaves exactly one blank line at the seam, however many surrounded the block', () => {
    expect(stripDiagrams(`Intro.\n\n\n${block()}\n\n\n\nOutro.\n`)).toBe('Intro.\n\nOutro.\n');
  });

  it('leaves no blank line above the text when the block opens it', () => {
    expect(stripDiagrams(`${block()}\n\nOutro.\n`)).toBe('Outro.\n');
  });

  it('leaves no blank line below the text when the block closes it', () => {
    expect(stripDiagrams(`Intro.\n\n${block()}\n`)).toBe('Intro.\n');
  });
});
