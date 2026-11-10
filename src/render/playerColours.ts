export type PlayerColourId = 'blue' | 'red' | 'green' | 'yellow';

export interface PlayerColour {
  id: PlayerColourId;
  name: string;
  tint: readonly [number, number, number];
  css: string;
  ghostCss: string;
}

export const PLAYER_COLOURS: readonly PlayerColour[] = [
  {
    id: 'blue',
    name: 'Blue',
    tint: [0.2, 0.5, 0.9],
    css: '#3b82f6',
    ghostCss: '#1e3a8a',
  },
  {
    id: 'red',
    name: 'Red',
    tint: [0.9, 0.2, 0.2],
    css: '#ef4444',
    ghostCss: '#991b1b',
  },
  {
    id: 'green',
    name: 'Green',
    tint: [0.25, 0.7, 0.3],
    css: '#22c55e',
    ghostCss: '#166534',
  },
  {
    id: 'yellow',
    name: 'Yellow',
    tint: [0.9, 0.75, 0.2],
    css: '#eab308',
    ghostCss: '#854d0e',
  },
];

export function getPlayerColour(id: PlayerColourId): PlayerColour {
  return PLAYER_COLOURS.find((colour) => colour.id === id)!;
}
