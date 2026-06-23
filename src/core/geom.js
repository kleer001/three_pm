// Shared 2D geometry helpers. Kept in core/ (not draw.js) so non-rendering
// modules can pull pure math without dragging in the canvas layer.
export const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
