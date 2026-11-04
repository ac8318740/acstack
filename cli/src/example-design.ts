// Test support: the worked example's design doc, read from its files map.
import { fileURLToPath } from 'node:url';
import { designFromNodes } from './lib/design-doc.js';
import { loadNodes } from './lib/nodes.js';

export const EXAMPLE_ROOT = fileURLToPath(new URL('../../examples/design-doc/acstack', import.meta.url));
export const EXAMPLE_MAP = 'acstack-design';
export const exampleDesign = () => designFromNodes(EXAMPLE_MAP, loadNodes(EXAMPLE_ROOT, EXAMPLE_MAP)).doc;
// Node ids of the example's elements, by the names the layout tests use.
export const EX = { user: '002', acstack: '003', skills: '004', host: '005', cli: '006', 'review-runtime': '007', viewer: '008', 'design-source': '009', github: '010' } as const;
