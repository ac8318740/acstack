import mermaid from 'mermaid';

// Runs only in an opaque-origin iframe with no network access or parent access.
mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', suppressErrorRendering: true, maxTextSize: 50_000 });
const source = JSON.parse(document.getElementById('source')!.textContent) as string;
const output = document.getElementById('diagram')!;
void mermaid.render('sidebar-diagram', source).then(({ svg }) => {
  output.innerHTML = svg;
}).catch(() => {
  output.textContent = 'Unable to render this Mermaid diagram. Check the source below.';
  output.setAttribute('role', 'alert');
  const details = document.createElement('details');
  const summary = document.createElement('summary');
  summary.textContent = 'Diagram source';
  const code = document.createElement('pre');
  code.textContent = source;
  details.append(summary, code);
  output.after(details);
});
