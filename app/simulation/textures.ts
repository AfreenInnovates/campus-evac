"use client";

import * as THREE from "three";

/**
 * Procedural canvas textures, drawn once in the browser and cached: floor tiles, plaster,
 * ceiling tiles, wood, paving, painted signage, sunset window views and soft glow sprites.
 * No image files are loaded, so nothing extra ships and the CSP stays untouched.
 */

type Draw = (ctx: CanvasRenderingContext2D, width: number, height: number) => void;

const cache = new Map<string, THREE.Texture>();

export const SIGN_FONT = '"Segoe UI", "Helvetica Neue", Arial, system-ui, sans-serif';
export const HAND_FONT = '"Segoe Print", "Bradley Hand", "Comic Sans MS", cursive';

function seeded(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function shade(hex: string, factor: number) {
  const color = new THREE.Color(hex);
  color.multiplyScalar(factor);
  return `#${color.getHexString()}`;
}

function canvasTexture(key: string, width: number, height: number, draw: Draw) {
  const hit = cache.get(key);
  if (hit) return hit;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (ctx) draw(ctx, width, height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  cache.set(key, texture);
  return texture;
}

/** A repeating copy of a base texture. Clones share the image source, so they cost no redraw. */
function tiled(base: THREE.Texture, key: string, repeatX: number, repeatY: number) {
  const id = `${key}@${repeatX.toFixed(2)}x${repeatY.toFixed(2)}`;
  const hit = cache.get(id);
  if (hit) return hit;
  const texture = base.clone();
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeatX, repeatY);
  texture.needsUpdate = true;
  cache.set(id, texture);
  return texture;
}

/** Glossy square floor tiles. `width`/`depth` are world metres; one tile is `tile` metres. */
export function floorTiles(tint: string, width: number, depth: number, tile = 1.2) {
  const key = `floor:${tint}`;
  const base = canvasTexture(key, 512, 512, (ctx, w, h) => {
    const rand = seeded(11);
    const count = 4;
    const cell = w / count;
    for (let i = 0; i < count; i++)
      for (let j = 0; j < count; j++) {
        ctx.fillStyle = shade(tint, 0.93 + rand() * 0.12);
        ctx.fillRect(i * cell, j * cell, cell, cell);
        const sheen = ctx.createLinearGradient(i * cell, j * cell, (i + 1) * cell, (j + 1) * cell);
        sheen.addColorStop(0, "rgba(255,255,255,0.08)");
        sheen.addColorStop(1, "rgba(0,0,0,0.05)");
        ctx.fillStyle = sheen;
        ctx.fillRect(i * cell, j * cell, cell, cell);
      }
    ctx.strokeStyle = "rgba(48,38,58,0.32)";
    ctx.lineWidth = 3;
    for (let k = 0; k <= count; k++) {
      ctx.beginPath();
      ctx.moveTo(k * cell, 0);
      ctx.lineTo(k * cell, h);
      ctx.moveTo(0, k * cell);
      ctx.lineTo(w, k * cell);
      ctx.stroke();
    }
  });
  return tiled(base, key, width / (tile * 4), depth / (tile * 4));
}

/** Softly mottled painted plaster. */
export function plaster(color: string, width: number, height: number) {
  const key = `plaster:${color}`;
  const base = canvasTexture(key, 256, 256, (ctx, w, h) => {
    const rand = seeded(29);
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 900; i++) {
      const light = rand() > 0.5;
      ctx.fillStyle = light ? "rgba(255,255,255,0.05)" : "rgba(40,30,50,0.045)";
      const size = 2 + rand() * 10;
      ctx.fillRect(rand() * w, rand() * h, size, size);
    }
  });
  return tiled(base, key, width / 3, height / 3);
}

/** Suspended acoustic ceiling tiles. */
export function ceilingTiles(width: number, depth: number) {
  const key = "ceiling";
  const base = canvasTexture(key, 256, 256, (ctx, w, h) => {
    const rand = seeded(5);
    ctx.fillStyle = "#e9e3ea";
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 1400; i++) {
      ctx.fillStyle = `rgba(90,80,100,${0.05 + rand() * 0.08})`;
      ctx.fillRect(rand() * w, rand() * h, 1.5, 1.5);
    }
    ctx.strokeStyle = "#b9b1be";
    ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, w / 2 - 4, h / 2 - 4);
    ctx.strokeRect(w / 2 + 2, 2, w / 2 - 4, h / 2 - 4);
    ctx.strokeRect(2, h / 2 + 2, w / 2 - 4, h / 2 - 4);
    ctx.strokeRect(w / 2 + 2, h / 2 + 2, w / 2 - 4, h / 2 - 4);
  });
  return tiled(base, key, width / 2.4, depth / 2.4);
}

/** Warm wood grain for desks, benches and doors. */
export function wood(tint = "#b07a4b", width = 1, height = 1) {
  const key = `wood:${tint}`;
  const base = canvasTexture(key, 256, 256, (ctx, w, h) => {
    const rand = seeded(17);
    ctx.fillStyle = tint;
    ctx.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 2) {
      const wave = Math.sin(y * 0.09) * 0.5 + Math.sin(y * 0.021) * 0.5;
      ctx.fillStyle = `rgba(60,34,18,${0.05 + Math.abs(wave) * 0.09 + rand() * 0.03})`;
      ctx.fillRect(0, y, w, 1);
    }
    ctx.strokeStyle = "rgba(50,28,14,0.35)";
    ctx.lineWidth = 2;
    for (let x = 64; x < w; x += 64) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
  });
  return tiled(base, key, width, height);
}

/** Large stone pavers for the plaza. */
export function paving(width: number, depth: number) {
  const key = "paving";
  const base = canvasTexture(key, 512, 512, (ctx, w, h) => {
    const rand = seeded(41);
    const rows = 4;
    const cell = h / rows;
    for (let r = 0; r < rows; r++) {
      const offset = r % 2 ? cell : 0;
      for (let c = -1; c < 3; c++) {
        const x = c * cell * 2 + offset;
        ctx.fillStyle = shade("#9c8ea3", 0.9 + rand() * 0.16);
        ctx.fillRect(x, r * cell, cell * 2, cell);
        ctx.strokeStyle = "rgba(40,30,50,0.4)";
        ctx.lineWidth = 3;
        ctx.strokeRect(x, r * cell, cell * 2, cell);
      }
    }
    for (let i = 0; i < 1800; i++) {
      ctx.fillStyle = `rgba(255,255,255,${rand() * 0.05})`;
      ctx.fillRect(rand() * w, rand() * h, 2, 2);
    }
  });
  return tiled(base, key, width / 8, depth / 8);
}

export interface SignLine {
  text: string;
  size: number;
  color?: string;
  weight?: number;
  font?: string;
  /** Extra space above this line, in canvas pixels. */
  gap?: number;
  tracking?: number;
}

export interface SignOptions {
  lines: SignLine[];
  width?: number;
  height?: number;
  background?: string | null;
  border?: string | null;
  align?: CanvasTextAlign;
  valign?: "top" | "center";
  padding?: number;
  /** Optional glyph drawn on the left, e.g. an arrow or a flask. */
  icon?: "flask" | "molecule" | "arrow-left" | "arrow-right" | "arrow-up" | "running" | "hazard" | "cross" | null;
  iconColor?: string;
}

function drawIcon(ctx: CanvasRenderingContext2D, icon: NonNullable<SignOptions["icon"]>, x: number, y: number, size: number, color: string) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = Math.max(3, size * 0.09);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const s = size;
  if (icon === "flask") {
    ctx.beginPath();
    ctx.moveTo(x + s * 0.38, y);
    ctx.lineTo(x + s * 0.38, y + s * 0.38);
    ctx.lineTo(x + s * 0.1, y + s * 0.92);
    ctx.lineTo(x + s * 0.9, y + s * 0.92);
    ctx.lineTo(x + s * 0.62, y + s * 0.38);
    ctx.lineTo(x + s * 0.62, y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x + s * 0.22, y + s * 0.68);
    ctx.lineTo(x + s * 0.78, y + s * 0.68);
    ctx.stroke();
  } else if (icon === "molecule") {
    const points: [number, number][] = [[0.5, 0.2], [0.2, 0.75], [0.82, 0.72], [0.5, 0.5]];
    ctx.beginPath();
    for (const [px, py] of points.slice(0, 3)) {
      ctx.moveTo(x + s * 0.5, y + s * 0.5);
      ctx.lineTo(x + s * px, y + s * py);
    }
    ctx.stroke();
    for (const [px, py] of points) {
      ctx.beginPath();
      ctx.arc(x + s * px, y + s * py, s * 0.11, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (icon.startsWith("arrow")) {
    ctx.translate(x + s / 2, y + s / 2);
    ctx.rotate(icon === "arrow-left" ? Math.PI : icon === "arrow-up" ? -Math.PI / 2 : 0);
    ctx.beginPath();
    ctx.moveTo(-s * 0.4, 0);
    ctx.lineTo(s * 0.4, 0);
    ctx.moveTo(s * 0.12, -s * 0.28);
    ctx.lineTo(s * 0.4, 0);
    ctx.lineTo(s * 0.12, s * 0.28);
    ctx.stroke();
  } else if (icon === "running") {
    ctx.beginPath();
    ctx.arc(x + s * 0.6, y + s * 0.14, s * 0.11, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x + s * 0.55, y + s * 0.3);
    ctx.lineTo(x + s * 0.45, y + s * 0.62);
    ctx.lineTo(x + s * 0.2, y + s * 0.92);
    ctx.moveTo(x + s * 0.45, y + s * 0.62);
    ctx.lineTo(x + s * 0.7, y + s * 0.8);
    ctx.lineTo(x + s * 0.72, y + s * 0.98);
    ctx.moveTo(x + s * 0.52, y + s * 0.38);
    ctx.lineTo(x + s * 0.25, y + s * 0.45);
    ctx.moveTo(x + s * 0.52, y + s * 0.38);
    ctx.lineTo(x + s * 0.82, y + s * 0.5);
    ctx.stroke();
  } else if (icon === "hazard") {
    ctx.beginPath();
    ctx.moveTo(x + s * 0.5, y + s * 0.05);
    ctx.lineTo(x + s * 0.95, y + s * 0.9);
    ctx.lineTo(x + s * 0.05, y + s * 0.9);
    ctx.closePath();
    ctx.stroke();
    ctx.fillRect(x + s * 0.46, y + s * 0.35, s * 0.08, s * 0.3);
    ctx.fillRect(x + s * 0.46, y + s * 0.72, s * 0.08, s * 0.08);
  } else if (icon === "cross") {
    ctx.fillRect(x + s * 0.36, y + s * 0.1, s * 0.28, s * 0.8);
    ctx.fillRect(x + s * 0.1, y + s * 0.36, s * 0.8, s * 0.28);
  }
  ctx.restore();
}

/** Painted text for walls, banners, posters, boards and signs. Cached by `key`. */
export function signTexture(key: string, options: SignOptions) {
  const width = options.width ?? 1024;
  const height = options.height ?? 256;
  return canvasTexture(`sign:${key}`, width, height, (ctx, w, h) => {
    const padding = options.padding ?? Math.round(h * 0.12);
    if (options.background) {
      ctx.fillStyle = options.background;
      ctx.fillRect(0, 0, w, h);
    }
    if (options.border) {
      ctx.strokeStyle = options.border;
      ctx.lineWidth = Math.max(4, h * 0.03);
      ctx.strokeRect(ctx.lineWidth / 2, ctx.lineWidth / 2, w - ctx.lineWidth, h - ctx.lineWidth);
    }
    let left = padding;
    if (options.icon) {
      const size = h - padding * 2;
      drawIcon(ctx, options.icon, padding, padding, size, options.iconColor ?? options.lines[0]?.color ?? "#fff");
      left += size + padding * 0.8;
    }
    const align = options.align ?? (options.icon ? "left" : "center");
    const total = options.lines.reduce((sum, line) => sum + line.size * 1.12 + (line.gap ?? 0), 0);
    let y = options.valign === "top" ? padding : (h - total) / 2;
    for (const line of options.lines) {
      y += line.gap ?? 0;
      ctx.font = `${line.weight ?? 700} ${line.size}px ${line.font ?? SIGN_FONT}`;
      ctx.fillStyle = line.color ?? "#ffffff";
      ctx.textAlign = align;
      ctx.textBaseline = "top";
      const context = ctx as CanvasRenderingContext2D & { letterSpacing?: string };
      if ("letterSpacing" in context) context.letterSpacing = `${line.tracking ?? 0}px`;
      const x = align === "center" ? (left + w - padding) / 2 : align === "right" ? w - padding : left;
      ctx.fillText(line.text, x, y, w - left - padding);
      y += line.size * 1.12;
    }
  });
}

/** A late-sunset view through a window: gradient sky, sun, city blocks and trees. */
export function sunsetView(key: string, seed = 3) {
  return canvasTexture(`sunset:${key}`, 512, 384, (ctx, w, h) => {
    const rand = seeded(seed);
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, "#6f4fb0");
    sky.addColorStop(0.42, "#d86a8f");
    sky.addColorStop(0.72, "#ff9a62");
    sky.addColorStop(1, "#ffd08a");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);
    const sun = ctx.createRadialGradient(w * 0.66, h * 0.62, 4, w * 0.66, h * 0.62, h * 0.4);
    sun.addColorStop(0, "rgba(255,244,210,1)");
    sun.addColorStop(0.25, "rgba(255,196,120,0.8)");
    sun.addColorStop(1, "rgba(255,150,90,0)");
    ctx.fillStyle = sun;
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 9; i++) {
      const bw = 30 + rand() * 60;
      const bh = 60 + rand() * 150;
      const bx = rand() * w;
      ctx.fillStyle = `rgba(92,60,110,${0.55 + rand() * 0.3})`;
      ctx.fillRect(bx, h - bh, bw, bh);
      ctx.fillStyle = "rgba(255,210,140,0.55)";
      for (let wy = h - bh + 12; wy < h - 10; wy += 18)
        for (let wx = bx + 6; wx < bx + bw - 8; wx += 14) if (rand() > 0.55) ctx.fillRect(wx, wy, 6, 8);
    }
    for (let i = 0; i < 7; i++) {
      const tx = rand() * w;
      const tr = 26 + rand() * 30;
      ctx.fillStyle = `rgba(60,70,60,${0.7 + rand() * 0.2})`;
      ctx.beginPath();
      ctx.arc(tx, h - tr * 0.6, tr, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

/** A facade of window bays on concrete, some lit warm and some dark. */
export function windowGrid(key: string, cols: number, rows: number, seed = 7) {
  const cell = 64;
  return canvasTexture(`windows:${key}`, cols * cell, rows * cell, (ctx, w, h) => {
    const rand = seeded(seed);
    ctx.fillStyle = "#b9a9ba";
    ctx.fillRect(0, 0, w, h);
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const x = c * cell + 8;
        const y = r * cell + 10;
        const width = cell - 16;
        const height = cell - 22;
        const lit = rand() > 0.55;
        const glass = ctx.createLinearGradient(x, y, x, y + height);
        glass.addColorStop(0, lit ? "#ffe2a6" : "#5b4a6e");
        glass.addColorStop(1, lit ? "#ffb86b" : "#3a3048");
        ctx.fillStyle = glass;
        ctx.fillRect(x, y, width, height);
        ctx.strokeStyle = "#8e7f92";
        ctx.lineWidth = 3;
        ctx.strokeRect(x, y, width, height);
        ctx.beginPath();
        ctx.moveTo(x + width / 2, y);
        ctx.lineTo(x + width / 2, y + height);
        ctx.stroke();
        ctx.fillStyle = "#a393a6";
        ctx.fillRect(x - 4, y + height + 2, width + 8, 5);
      }
  });
}

/** Radial white-to-clear sprite used for additive light halos. */
export function glowTexture() {
  return canvasTexture("glow", 128, 128, (ctx, w, h) => {
    const gradient = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    gradient.addColorStop(0, "rgba(255,255,255,1)");
    gradient.addColorStop(0.25, "rgba(255,255,255,0.55)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);
  });
}
