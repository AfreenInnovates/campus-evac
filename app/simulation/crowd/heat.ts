import { FIELDS, STATUS } from "./replay";

/**
 * Where people got stuck: person-seconds spent standing still inside the building, on a 1 m
 * grid, read off a drill's recorded frames. People sheltering on purpose are left out, and so is
 * the wait for a person's first decision (that is the model, not the person; freezing in panic
 * still counts), so the hot spots are bottlenecks, dead ends and hesitation. Collapses are kept
 * as points.
 *
 * Pure data in, pure data out; `paintHeat` turns a grid into an image for the 3D floor or the
 * audit map.
 */

export const HEAT = { minX: -24, maxX: 24, minZ: -46, maxZ: 12, cell: 1 };
const COLS = Math.round((HEAT.maxX - HEAT.minX) / HEAT.cell);
const ROWS = Math.round((HEAT.maxZ - HEAT.minZ) / HEAT.cell);
/** slower than this between two frames counts as standing still (m/s) */
const STILL = 0.35;

export interface Heat {
  grid: Float32Array;
  /** where people collapsed */
  falls: [number, number][];
}

export const emptyHeat = (): Heat => ({ grid: new Float32Array(COLS * ROWS), falls: [] });

/** Add one drill's frames to a heat grid (so several drills can share one). */
export function addFrames(heat: Heat, frames: number[][], people: number) {
  const inside = STATUS.indexOf("inside");
  const down = STATUS.indexOf("down");
  for (let f = 1; f < frames.length; f++) {
    const a = frames[f - 1];
    const b = frames[f];
    const dt = b[0] - a[0];
    if (dt <= 0) continue;
    for (let p = 0; p < people; p++) {
      const o = 1 + p * FIELDS;
      if (b[o + 3] === down && a[o + 3] !== down) heat.falls.push([b[o], b[o + 1]]);
      // sheltering on purpose is not being stuck
      if (b[o + 3] !== inside || b[o + 4] === 1) continue;
      // still before their first decision is the model thinking, not the person: unless frozen in panic (2)
      if (b[o + 7] < 0 && b[o + 4] !== 2) continue;
      if (Math.hypot(b[o] - a[o], b[o + 1] - a[o + 1]) / dt > STILL) continue;
      const c = Math.floor((b[o] - HEAT.minX) / HEAT.cell);
      const r = Math.floor((b[o + 1] - HEAT.minZ) / HEAT.cell);
      if (c >= 0 && r >= 0 && c < COLS && r < ROWS) heat.grid[r * COLS + c] += dt;
    }
  }
  return heat;
}

/** Soften single cells into areas: two passes of a 3x3 box blur. */
function blur(grid: Float32Array) {
  let src = grid;
  for (let pass = 0; pass < 2; pass++) {
    const out = new Float32Array(src.length);
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++) {
        let sum = 0;
        let n = 0;
        for (let dr = -1; dr <= 1; dr++)
          for (let dc = -1; dc <= 1; dc++) {
            const rr = r + dr;
            const cc = c + dc;
            if (rr < 0 || cc < 0 || rr >= ROWS || cc >= COLS) continue;
            sum += src[rr * COLS + cc];
            n++;
          }
        out[r * COLS + c] = sum / n;
      }
    src = out;
  }
  return src;
}

/** Transparent where nobody waited, through amber to red where people were stuck longest. */
export function paintHeat(heat: Heat, scale = 8): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = COLS * scale;
  canvas.height = ROWS * scale;
  const ctx = canvas.getContext("2d")!;
  const smooth = blur(heat.grid);
  let max = 0;
  for (const v of smooth) max = Math.max(max, v);
  if (max > 0) {
    const small = ctx.createImageData(COLS, ROWS);
    for (let i = 0; i < smooth.length; i++) {
      // square root, so a short wait still shows next to a long one
      const k = Math.sqrt(smooth[i] / max);
      if (k < 0.06) continue;
      small.data[i * 4] = 255;
      small.data[i * 4 + 1] = Math.round(220 * (1 - k));
      small.data[i * 4 + 2] = 40;
      small.data[i * 4 + 3] = Math.round(70 + 170 * k);
    }
    const tmp = document.createElement("canvas");
    tmp.width = COLS;
    tmp.height = ROWS;
    tmp.getContext("2d")!.putImageData(small, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.filter = `blur(${scale * 0.6}px)`; // soft edges; browsers without canvas filters just skip it
    ctx.drawImage(tmp, 0, 0, canvas.width, canvas.height);
    ctx.filter = "none";
  }
  // a cross where each person collapsed
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = Math.max(2, scale / 3);
  for (const [x, z] of heat.falls) {
    const px = ((x - HEAT.minX) / HEAT.cell) * scale;
    const pz = ((z - HEAT.minZ) / HEAT.cell) * scale;
    const s = scale * 0.7;
    ctx.beginPath();
    ctx.moveTo(px - s, pz - s);
    ctx.lineTo(px + s, pz + s);
    ctx.moveTo(px + s, pz - s);
    ctx.lineTo(px - s, pz + s);
    ctx.stroke();
  }
  return canvas;
}
