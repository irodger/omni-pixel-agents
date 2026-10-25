import type { OfficeLayout } from '../office/types.js';
import { TILE_SIZE, TileType } from '../office/types.js';

/** Fit the occupied room, rather than the unused expansion tiles around it. */
export function projectViewport(layout: OfficeLayout, width: number, height: number) {
  let left = layout.cols,
    top = layout.rows,
    right = -1,
    bottom = -1;
  for (let row = 0; row < layout.rows; row++)
    for (let col = 0; col < layout.cols; col++) {
      const tile = layout.tiles[row * layout.cols + col];
      if (tile === undefined || tile === TileType.VOID) continue;
      left = Math.min(left, col);
      top = Math.min(top, row);
      right = Math.max(right, col);
      bottom = Math.max(bottom, row);
    }
  if (right < 0) {
    left = 0;
    top = 0;
    right = layout.cols - 1;
    bottom = layout.rows - 1;
  }
  const zoom = Math.min(
    width / ((right - left + 3) * TILE_SIZE),
    height / ((bottom - top + 3) * TILE_SIZE),
  );
  return {
    zoom,
    panX: (layout.cols / 2 - (left + right + 1) / 2) * TILE_SIZE * zoom,
    panY: (layout.rows / 2 - (top + bottom + 1) / 2) * TILE_SIZE * zoom,
  };
}
