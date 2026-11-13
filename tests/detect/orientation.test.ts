import { createCanvas } from '@napi-rs/canvas';
import { describe, expect, it } from 'vitest';
import { rotationsToTry, settleRotations, staffAxis } from '@/lib/detect/orientation';

/** A white page with staves, optionally running down the page instead of across. */
function staves(width: number, height: number, down: boolean) {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 2;
  const across = down ? width : height;
  const along = down ? height : width;
  for (let system = 0; system * 120 + 140 < across; system++) {
    for (let line = 0; line < 5; line++) {
      const at = 60 + system * 120 + line * 12;
      ctx.beginPath();
      if (down) {
        ctx.moveTo(at, 40);
        ctx.lineTo(at, along - 40);
      } else {
        ctx.moveTo(40, at);
        ctx.lineTo(along - 40, at);
      }
      ctx.stroke();
    }
    // Barlines across each staff, as a real score has.
    for (let bar = 40; bar < along - 40; bar += 150) {
      ctx.beginPath();
      if (down) {
        ctx.moveTo(60 + system * 120, bar);
        ctx.lineTo(60 + system * 120 + 48, bar);
      } else {
        ctx.moveTo(bar, 60 + system * 120);
        ctx.lineTo(bar, 60 + system * 120 + 48);
      }
      ctx.stroke();
    }
  }
  return ctx.getImageData(0, 0, width, height).data;
}

describe('staffAxis', () => {
  it('sees staves running across a page', () => {
    expect(staffAxis(staves(620, 877, false), 620, 877)).toBe('horizontal');
  });
  it('sees staves running down a page turned a quarter', () => {
    expect(staffAxis(staves(877, 620, true), 877, 620)).toBe('vertical');
  });
  it('gives up on a blank page', () => {
    const blank = new Uint8ClampedArray(100 * 100 * 4).fill(255);
    expect(staffAxis(blank, 100, 100)).toBeNull();
  });
});

describe('rotationsToTry', () => {
  it('tries the two rotations the staves allow, the last one that worked first', () => {
    expect(rotationsToTry('horizontal', 0)).toEqual([0, 180]);
    expect(rotationsToTry('horizontal', 180)).toEqual([180, 0]);
    expect(rotationsToTry('vertical', 0)).toEqual([90, 270]);
    expect(rotationsToTry('vertical', 270)).toEqual([270, 90]);
  });
  it('tries every rotation when the staves do not tell', () => {
    expect(rotationsToTry(null, 90)).toEqual([90, 0, 180, 270]);
  });
});

describe('settleRotations', () => {
  it('keeps the rotation a part name was read in', () => {
    expect(settleRotations([{ axis: 'horizontal', named: 180, wordy: null }])).toEqual([180]);
  });
  it('turns a page without a name like the page before it', () => {
    const named = { axis: 'vertical' as const, named: 270 as const, wordy: null };
    const plain = { axis: 'vertical' as const, named: null, wordy: null };
    expect(settleRotations([named, plain, plain])).toEqual([270, 270, 270]);
  });
  it('prefers the rotation that gave clearly more text', () => {
    expect(
      settleRotations([
        { axis: 'horizontal', named: 0, wordy: null },
        { axis: 'horizontal', named: null, wordy: 180 },
      ]),
    ).toEqual([0, 180]);
  });
  it('does not follow the page before when the staves say otherwise', () => {
    expect(
      settleRotations([
        { axis: 'vertical', named: 90, wordy: null },
        { axis: 'horizontal', named: null, wordy: null },
      ]),
    ).toEqual([90, 0]);
  });
});
