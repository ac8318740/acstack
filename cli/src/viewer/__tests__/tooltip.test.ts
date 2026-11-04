import { expect, it } from 'vitest';
import { describedBy, tooltipPosition } from '../tooltip.js';

it('centers below the target when the tooltip fits', () => {
  expect(tooltipPosition({ left: 100, top: 100, width: 40, height: 20 }, { width: 100, height: 30 }, { width: 800, height: 600 })).toEqual({ left: 70, top: 128 });
});
it('flips above a bottom target and clamps both horizontal edges', () => {
  expect(tooltipPosition({ left: 790, top: 570, width: 10, height: 20 }, { width: 100, height: 30 }, { width: 800, height: 600 })).toEqual({ left: 692, top: 532 });
  expect(tooltipPosition({ left: 0, top: 0, width: 10, height: 20 }, { width: 100, height: 30 }, { width: 800, height: 600 }).left).toBe(8);
});
it('keeps oversized tooltip coordinates within the viewport margin', () => {
  expect(tooltipPosition({ left: -30, top: -20, width: 10, height: 10 }, { width: 280, height: 100 }, { width: 100, height: 60 })).toEqual({ left: 8, top: 8 });
});
it('adds and removes only its own description token', () => {
  expect(describedBy('help error', 'tooltip', true)).toBe('help error tooltip');
  expect(describedBy('help tooltip error', 'tooltip', false)).toBe('help error');
  expect(describedBy('tooltip', 'tooltip', false)).toBeNull();
  expect(describedBy(null, 'tooltip', true)).toBe('tooltip');
  expect(describedBy('help tooltip', 'tooltip', true)).toBe('help tooltip');
});
