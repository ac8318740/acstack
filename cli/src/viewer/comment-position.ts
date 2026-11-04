type Rect = { left: number; right: number; top: number; bottom: number };
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max));

// All coordinates are viewport-relative, including the visible canvas bounds.
export function commentPosition(anchor: Rect, canvas: Rect, drawer: Rect | undefined, size: { width: number; height: number }, viewport: { width: number; height: number }, fromDrawer: boolean) {
  const gap = 8;
  const margin = 8;
  const stacked = drawer && drawer.top >= canvas.bottom - 1;
  const leftBound = Math.max(canvas.left, 0) + margin;
  const rightBound = Math.max(leftBound, Math.min(canvas.right - margin, viewport.width - margin, drawer && !stacked ? drawer.left - gap : Infinity));
  const topBound = Math.max(canvas.top, 0) + margin;
  const bottomBound = Math.max(topBound, Math.min(canvas.bottom - margin, viewport.height - margin, stacked ? drawer.top - gap : Infinity));
  const maxWidth = rightBound - leftBound;
  const maxHeight = Math.min(480, bottomBound - topBound);
  const width = Math.min(size.width, maxWidth);
  const height = Math.min(size.height, maxHeight);
  let left = fromDrawer ? rightBound - width : anchor.left - gap - width;
  let top = (anchor.top + anchor.bottom - height) / 2;
  if (!fromDrawer && left < leftBound) {
    if (anchor.right + gap + width <= rightBound) left = anchor.right + gap;
    else {
      left = anchor.left;
      top = anchor.bottom + gap + height <= bottomBound ? anchor.bottom + gap : anchor.top - gap - height;
    }
  }
  if (fromDrawer && stacked) top = bottomBound - height;
  return { left: clamp(left, leftBound, rightBound - width), top: clamp(top, topBound, bottomBound - height), maxWidth, maxHeight };
}
