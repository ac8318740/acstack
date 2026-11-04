import { afterEach, expect, it, vi } from 'vitest';
const render = vi.hoisted(() => vi.fn());
vi.mock('mermaid', () => ({ default: { initialize: vi.fn(), render } }));
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

it.each([false, true])('shows source only when rendering fails (failure=%s)', async failed => {
  const source = 'flowchart LR\nA --> B </pre><script>bad()</script>';
  const output = { innerHTML: '', textContent: '', setAttribute: vi.fn(), after: vi.fn() };
  const createElement = (tag: string) => ({ tag, textContent: '', append: vi.fn() });
  vi.stubGlobal('document', { getElementById: (id: string) => id === 'source' ? { textContent: JSON.stringify(source) } : output, createElement });
  render.mockImplementation(() => failed ? Promise.reject(new Error('Invalid diagram')) : Promise.resolve({ svg: '<svg>diagram</svg>' }));
  await import('./mermaid-frame.js');
  await vi.dynamicImportSettled();
  if (failed) {
    expect(output.setAttribute).toHaveBeenCalledWith('role', 'alert');
    const details = output.after.mock.calls[0][0] as ReturnType<typeof createElement>;
    const [summary, code] = details.append.mock.calls[0] as ReturnType<typeof createElement>[];
    expect(details.tag).toBe('details');
    expect(summary.textContent).toBe('Diagram source');
    expect(code.textContent).toBe(source);
    expect(code).not.toHaveProperty('innerHTML');
  } else {
    expect(output.innerHTML).toBe('<svg>diagram</svg>');
    expect(output.after).not.toHaveBeenCalled();
  }
});
