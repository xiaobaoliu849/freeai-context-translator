const EDGE = 12;

export function getFloatingSize(viewport: { width: number; height: number }, expanded = false) {
  return {
    width: Math.max(0, Math.min(expanded ? 820 : 560, viewport.width - EDGE * 2)),
    height: Math.max(0, Math.min(expanded ? 900 : 720, viewport.height - EDGE * 2)),
  };
}

/** Positions are document coordinates; dimensions are CSS pixels. */
export function clampFloatingPosition(
  position: { x: number; y: number },
  size: { width: number; height: number },
  viewport: { width: number; height: number; scrollX: number; scrollY: number },
) {
  return {
    x: Math.max(viewport.scrollX + EDGE, Math.min(position.x, viewport.scrollX + viewport.width - size.width - EDGE)),
    y: Math.max(viewport.scrollY + EDGE, Math.min(position.y, viewport.scrollY + viewport.height - size.height - EDGE)),
  };
}
