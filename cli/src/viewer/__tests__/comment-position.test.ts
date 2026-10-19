import { expect, it } from 'vitest';
import { commentPosition } from '../comment-position.js';

const canvas = { left: 0, right: 1000, top: 48, bottom: 900 };
const drawer = { left: 1000, right: 1360, top: 48, bottom: 900 };
const viewport = { width: 1360, height: 900 };
const size = { width: 320, height: 250 };
const anchor = { left: 1080, right: 1200, top: 200, bottom: 220 };

it('keeps drawer comments immediately left of the drawer with a gap', () => {
  const position = commentPosition(anchor, canvas, drawer, size, viewport, true);
  expect(position.left + size.width).toBe(drawer.left - 8);
  expect(position.top).toBeGreaterThanOrEqual(canvas.top + 8);
});

it('recomputes the boundary when the drawer widens', () => {
  const position = commentPosition(anchor, { ...canvas, right: 640 }, { ...drawer, left: 640 }, size, viewport, true);
  expect(position.left + size.width).toBe(632);
});

it.each([
  { left: 500, right: 580, top: 300, bottom: 320 },
  { left: 20, right: 80, top: 300, bottom: 320 },
  { left: 300, right: 800, top: 300, bottom: 320 },
])('avoids canvas selection when there is room: %j', selection => {
  const position = commentPosition(selection, canvas, drawer, size, viewport, false);
  expect(position.left >= selection.right + 8 || position.left + size.width <= selection.left - 8 || position.top >= selection.bottom + 8 || position.top + size.height <= selection.top - 8).toBe(true);
  expect(position.left).toBeGreaterThanOrEqual(8);
  expect(position.left + size.width).toBeLessThan(drawer.left);
});

it('keeps stacked drawer selections above the drawer and constrains oversized content', () => {
  const position = commentPosition(anchor, { left: 0, right: 300, top: 120, bottom: 450 }, { left: 0, right: 300, top: 450, bottom: 800 }, { width: 320, height: 600 }, { width: 300, height: 800 }, true);
  expect(position.maxWidth).toBe(284);
  expect(position.left).toBe(8);
  expect(position.top).toBe(128);
  expect(position.top + position.maxHeight).toBe(442);
});

it('caps long popovers while allowing short ones to use their natural height', () => {
  const long = commentPosition(anchor, canvas, drawer, { width: 320, height: 1200 }, viewport, true);
  expect(long.maxHeight).toBe(480);
  expect(long.top).toBeGreaterThanOrEqual(canvas.top + 8);
  expect(long.top + long.maxHeight).toBeLessThanOrEqual(canvas.bottom - 8);
  const short = commentPosition(anchor, canvas, drawer, size, viewport, true);
  expect(short.top + size.height / 2).toBe((anchor.top + anchor.bottom) / 2);
});

it('clamps actual popover height at the bottom of the visible viewport', () => {
  const position = commentPosition({ ...anchor, top: 890, bottom: 920 }, canvas, drawer, { width: 320, height: 400 }, { width: 1360, height: 700 }, true);
  expect(position.top + 400).toBe(692);
});
