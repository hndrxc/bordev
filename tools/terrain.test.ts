import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { expect, test } from 'vitest';

const terrains = ['grass', 'dirt', 'sand', 'shallow', 'water', 'rock-ground'];

test.each(terrains)('%s is an opaque, textured 512px seamless ground tile', async (terrain) => {
  const path = fileURLToPath(new URL(`../public/terrain/${terrain}.png`, import.meta.url));
  const image = sharp(path);
  const metadata = await image.metadata();
  expect(metadata.format).toBe('png');
  expect(metadata.width).toBe(512);
  expect(metadata.height).toBe(512);

  const { data, info } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const sums = [0, 0, 0];
  const squares = [0, 0, 0];
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const offset = pixel * channels;
    for (let channel = 0; channel < 3; channel += 1) {
      const value = data[offset + channel];
      sums[channel] += value;
      squares[channel] += value * value;
    }
    // Transparent holes expose neighbouring layers when terrain is splat-blended.
    if (data[offset + 3] !== 255) {
      throw new Error(`${terrain} contains a non-opaque pixel at ${pixel}`);
    }
  }

  for (let channel = 0; channel < 3; channel += 1) {
    const mean = sums[channel] / (width * height);
    const deviation = Math.sqrt(squares[channel] / (width * height) - mean * mean);
    // Reject solid-colour placeholders as well as almost-flat render failures.
    expect(deviation, `${terrain} channel ${channel} variation`).toBeGreaterThan(4);

    let horizontalDifference = 0;
    for (let y = 0; y < height; y += 1) {
      const left = (y * width) * channels + channel;
      const right = (y * width + width - 1) * channels + channel;
      horizontalDifference += Math.abs(data[left] - data[right]);
    }
    let verticalDifference = 0;
    for (let x = 0; x < width; x += 1) {
      const top = x * channels + channel;
      const bottom = ((height - 1) * width + x) * channels + channel;
      verticalDifference += Math.abs(data[top] - data[bottom]);
    }
    expect(horizontalDifference / height / 255, `${terrain} channel ${channel} left/right seam`)
      .toBeLessThan(3 / 255);
    expect(verticalDifference / width / 255, `${terrain} channel ${channel} top/bottom seam`)
      .toBeLessThan(3 / 255);
  }
});
