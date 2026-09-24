import { writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';

export function writeSolidPng(
  filePath: string,
  width: number,
  height: number,
  rgb: [number, number, number],
  paint: Array<{ x: number; y: number; rgb: [number, number, number] }> = []
): void {
  const png = new PNG({ width, height });
  for (let i = 0; i < width * height; i++) {
    png.data[i * 4] = rgb[0];
    png.data[i * 4 + 1] = rgb[1];
    png.data[i * 4 + 2] = rgb[2];
    png.data[i * 4 + 3] = 255;
  }
  for (const pixel of paint) {
    const i = (pixel.y * width + pixel.x) * 4;
    png.data[i] = pixel.rgb[0];
    png.data[i + 1] = pixel.rgb[1];
    png.data[i + 2] = pixel.rgb[2];
  }
  writeFileSync(filePath, PNG.sync.write(png));
}
