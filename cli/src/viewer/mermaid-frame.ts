import mermaid from 'mermaid';

// Runs only in an opaque-origin iframe with no network access or parent access.
// The app's palette: blue accents on neutral surfaces, so diagrams read as part of the page.
mermaid.initialize({
  startOnLoad: false, securityLevel: 'strict', suppressErrorRendering: true, maxTextSize: 50_000, theme: 'base',
  themeVariables: {
    fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif', fontSize: '14px',
    primaryColor: '#eef2fb', primaryBorderColor: '#3d58a8', primaryTextColor: '#1c2541', secondaryColor: '#f5f7fb', tertiaryColor: '#ffffff',
    lineColor: '#5d6782', textColor: '#1c2541', mainBkg: '#eef2fb', nodeBorder: '#3d58a8', clusterBkg: '#f7f8fb', clusterBorder: '#c9cfdc',
    actorBkg: '#eef2fb', actorBorder: '#3d58a8', actorTextColor: '#1c2541', actorLineColor: '#9aa3b8', signalColor: '#3b4660', signalTextColor: '#1c2541',
    noteBkgColor: '#fdf6e3', noteBorderColor: '#e0c97a', labelBoxBkgColor: '#eef2fb', labelBoxBorderColor: '#3d58a8',
    quadrant1Fill: '#eef2fb', quadrant2Fill: '#f5f7fb', quadrant3Fill: '#ffffff', quadrant4Fill: '#f5f7fb', quadrantPointFill: '#3d58a8', quadrantTitleFill: '#1c2541',
  },
});
const source = JSON.parse(document.getElementById('source')!.textContent) as string;
const output = document.getElementById('diagram')!;
// The host sizes the frame to the diagram, so nothing is cut off and no space is left below.
// A failed report must not turn a rendered diagram into the failure view, so it runs after either outcome.
// The body's own height plus its margins: the document's scroll height never drops below the frame's current size.
const report = () => { try { parent.postMessage({ mermaidHeight: Math.ceil(document.body.getBoundingClientRect().height) + 16 }, '*'); } catch { /* The fixed fallback height stays. */ } };
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
  details.addEventListener('toggle', report);
}).finally(report);
