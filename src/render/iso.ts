/**
 * Isometric dimetric 2:1 projection math and constants.
 *
 * Coordinate conventions:
 * - Screen coordinates: origin top-left, +X right, +Y down.
 * - World coordinates: right-handed (Babylon scene.useRightHandedSystem = true),
 *   Y is elevation (up), X and Z define the horizontal ground plane (Y = 0).
 *
 * Projection specification:
 * - World +X projects to screen (+48, +24) px per tile at zoom 1.
 * - World +Z projects to screen (-48, +24) px per tile at zoom 1.
 * - Tile (0, 0) is the top corner of the map diamond.
 * - PPU = 96 / Math.SQRT2 ≈ 67.88225.
 */

export const PPU = 96 / Math.SQRT2;

export const ISO_COS30 = Math.cos(Math.PI / 6);
export const ISO_SIN30 = Math.sin(Math.PI / 6);
export const ISO_SQRT2 = Math.SQRT2;

/** Camera distance along line-of-sight (>= 512 for map max 128) */
export const ISO_CAMERA_DISTANCE = 600;

/** Camera view direction unit vector (from target toward camera) */
export const ISO_CAMERA_DIR = {
  x: ISO_COS30 / ISO_SQRT2,
  y: ISO_SIN30,
  z: ISO_COS30 / ISO_SQRT2,
} as const;

/** Camera right world basis vector */
export const ISO_RIGHT_BASIS = {
  x: 1 / ISO_SQRT2,
  y: 0,
  z: -1 / ISO_SQRT2,
} as const;

/** Camera up world basis vector */
export const ISO_UP_BASIS = {
  x: -ISO_SIN30 / ISO_SQRT2,
  y: ISO_COS30,
  z: -ISO_SIN30 / ISO_SQRT2,
} as const;

export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 1.5;
export const MAP_MARGIN = 4;

export interface IsoView {
  targetX: number;
  targetZ: number;
  width: number;
  height: number;
  zoom: number;
}

/**
 * Projects a ground coordinate (x, z) to screen pixel coordinates (CSS/canvas).
 * Origin is screen top-left.
 */
export function worldToScreen(x: number, z: number, view: IsoView): { x: number; y: number } {
  const dx = x - view.targetX;
  const dz = z - view.targetZ;
  return {
    x: view.width * 0.5 + (dx - dz) * 48 * view.zoom,
    y: view.height * 0.5 + (dx + dz) * 24 * view.zoom,
  };
}

/**
 * Inverse projection: maps a screen pixel coordinate (x, y) to ground world coordinate (x, z).
 */
export function screenToGround(x: number, y: number, view: IsoView): { x: number; z: number } {
  const sx = (x - view.width * 0.5) / view.zoom;
  const sy = (y - view.height * 0.5) / view.zoom;
  const dx = sx / 96 + sy / 48;
  const dz = sy / 48 - sx / 96;
  return {
    x: view.targetX + dx,
    z: view.targetZ + dz,
  };
}

/**
 * Clamps a camera target coordinate within the map diamond + margin (in inverse iso world bounds).
 */
export function clampTarget(
  x: number,
  z: number,
  mapSize: number,
  margin: number = MAP_MARGIN,
): { x: number; z: number } {
  const min = -margin;
  const max = mapSize + margin;
  return {
    x: Math.max(min, Math.min(max, x)),
    z: Math.max(min, Math.min(max, z)),
  };
}
