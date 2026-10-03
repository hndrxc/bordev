export { TERRAIN_CODES as Terrain } from '../data/terrain.js';
export type { TerrainCode } from '../data/types.js';

export interface GameMap {
  version: 1;
  id: string;
  name: string;
  size: number;
  players: number;
  tiles: Uint8Array;
  goldMines: [number, number][];
  starts: [number, number][];
  doodads: [number, number, string][];
}

const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_LOOKUP = new Uint8Array(256);
for (let i = 0; i < B64_CHARS.length; i++) {
  B64_LOOKUP[B64_CHARS.charCodeAt(i)] = i;
}

export function decodeBase64(b64: string): Uint8Array {
  const str = b64.replace(/[\r\n\s]/g, '');
  const len = str.length;
  if (len === 0) return new Uint8Array(0);

  let placeHolders = 0;
  if (str[len - 1] === '=') {
    placeHolders++;
    if (str[len - 2] === '=') {
      placeHolders++;
    }
  }

  const byteLength = (len * 3) / 4 - placeHolders;
  const bytes = new Uint8Array(byteLength);
  let outIdx = 0;

  for (let i = 0; i < len; i += 4) {
    const a = B64_LOOKUP[str.charCodeAt(i)];
    const b = B64_LOOKUP[str.charCodeAt(i + 1)];
    const c = str[i + 2] === '=' ? 0 : B64_LOOKUP[str.charCodeAt(i + 2)];
    const d = str[i + 3] === '=' ? 0 : B64_LOOKUP[str.charCodeAt(i + 3)];

    const triple = (a << 18) | (b << 12) | (c << 6) | d;
    if (outIdx < byteLength) bytes[outIdx++] = (triple >> 16) & 0xff;
    if (outIdx < byteLength) bytes[outIdx++] = (triple >> 8) & 0xff;
    if (outIdx < byteLength) bytes[outIdx++] = triple & 0xff;
  }

  return bytes;
}

export function parseMap(value: unknown): GameMap {
  const raw: unknown = typeof value === 'string' ? JSON.parse(value) : value;

  if (!raw || typeof raw !== 'object') {
    throw new Error('Invalid map: expected object or JSON string');
  }

  const obj = raw as Record<string, unknown>;

  if (obj.version !== 1) {
    throw new Error(`Unsupported map version: ${String(obj.version)}`);
  }

  if (typeof obj.id !== 'string' || obj.id.trim() === '') {
    throw new Error('Invalid or missing map field: id');
  }
  const id = obj.id;
  const name = typeof obj.name === 'string' && obj.name.trim() !== '' ? obj.name : id;

  if (
    typeof obj.size !== 'number' ||
    !Number.isFinite(obj.size) ||
    obj.size <= 0 ||
    !Number.isInteger(obj.size)
  ) {
    throw new Error(`Invalid map size: ${String(obj.size)}`);
  }
  const size = obj.size;

  if (
    typeof obj.players !== 'number' ||
    !Number.isFinite(obj.players) ||
    obj.players <= 0 ||
    !Number.isInteger(obj.players)
  ) {
    throw new Error(`Invalid map players: ${String(obj.players)}`);
  }
  const players = obj.players;

  if (!obj.tiles) {
    throw new Error('Missing required map field: tiles');
  }

  let tiles: Uint8Array;
  if (typeof obj.tiles === 'string') {
    tiles = decodeBase64(obj.tiles);
  } else if (obj.tiles instanceof Uint8Array) {
    tiles = new Uint8Array(obj.tiles);
  } else if (Array.isArray(obj.tiles)) {
    tiles = new Uint8Array(obj.tiles.map((t) => Number(t)));
  } else {
    throw new Error('Invalid map tiles format');
  }

  const expectedTiles = size * size;
  if (tiles.length !== expectedTiles) {
    throw new Error(
      `Invalid map tiles length: expected ${expectedTiles}, got ${tiles.length}`,
    );
  }

  for (let i = 0; i < tiles.length; i++) {
    const code = tiles[i];
    if (code < 0 || code > 6) {
      throw new Error(`Invalid terrain code ${code} at tile index ${i}`);
    }
  }

  const goldMines: [number, number][] = [];
  if (Array.isArray(obj.goldMines)) {
    for (const item of obj.goldMines) {
      if (Array.isArray(item) && item.length >= 2) {
        goldMines.push([Number(item[0]), Number(item[1])]);
      }
    }
  }

  const starts: [number, number][] = [];
  if (Array.isArray(obj.starts)) {
    for (const item of obj.starts) {
      if (Array.isArray(item) && item.length >= 2) {
        starts.push([Number(item[0]), Number(item[1])]);
      }
    }
  }

  const doodads: [number, number, string][] = [];
  if (Array.isArray(obj.doodads)) {
    for (const item of obj.doodads) {
      if (Array.isArray(item) && item.length >= 3) {
        doodads.push([Number(item[0]), Number(item[1]), String(item[2])]);
      }
    }
  }

  return {
    version: 1,
    id,
    name,
    size,
    players,
    tiles,
    goldMines,
    starts,
    doodads,
  };
}
