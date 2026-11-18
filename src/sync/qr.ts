// Codificador QR mínimo y autocontenido: modo byte (UTF-8), corrección M, versiones 1–10 (hasta 213 bytes).
// Implementa Reed–Solomon sobre GF(256), intercalado de bloques, las 8 máscaras con penalización estándar
// y la información de formato y de versión. Salida: matriz booleana (true = módulo oscuro).

export interface QrMatrix {
  version: number;
  size: number;
  mask: number;
  /** modules[y][x] */
  modules: boolean[][];
}

const MAX_VERSION = 10;
// Índice = versión. Nivel M.
const ECC_PER_BLOCK = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
const NUM_BLOCKS = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
const ALIGN_POS: number[][] = [
  [], [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50],
];
const ECC_FORMAT_BITS_M = 0; // L=1, M=0, Q=3, H=2

/** Módulos disponibles para datos+ECC (sin patrones de función). */
function rawDataModules(ver: number): number {
  let r = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const n = Math.floor(ver / 7) + 2;
    r -= (25 * n - 10) * n - 55;
    if (ver >= 7) r -= 36;
  }
  return r;
}
const dataCodewords = (ver: number) => Math.floor(rawDataModules(ver) / 8) - ECC_PER_BLOCK[ver] * NUM_BLOCKS[ver];

// ---------- Reed–Solomon (GF(256), polinomio 0x11D) ----------

function gfMul(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

function rsDivisor(degree: number): number[] {
  const res = new Array<number>(degree).fill(0);
  res[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      res[j] = gfMul(res[j], root);
      if (j + 1 < degree) res[j] ^= res[j + 1];
    }
    root = gfMul(root, 0x02);
  }
  return res;
}

function rsRemainder(data: number[], divisor: number[]): number[] {
  const res = new Array<number>(divisor.length).fill(0);
  for (const b of data) {
    const factor = b ^ (res.shift() as number);
    res.push(0);
    divisor.forEach((coef, i) => { res[i] ^= gfMul(coef, factor); });
  }
  return res;
}

// ---------- Codificación ----------

function encodeData(bytes: Uint8Array, ver: number): number[] {
  const bits: number[] = [];
  const push = (val: number, len: number) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  push(0b0100, 4);
  push(bytes.length, ver <= 9 ? 8 : 16);
  for (const b of bytes) push(b, 8);
  const capacity = dataCodewords(ver) * 8;
  push(0, Math.min(4, capacity - bits.length));
  push(0, (8 - (bits.length % 8)) % 8);
  const out: number[] = [];
  for (let i = 0; i < bits.length; i += 8) out.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  for (let pad = 0xec; out.length < dataCodewords(ver); pad ^= 0xec ^ 0x11) out.push(pad);
  return out;
}

function addEccAndInterleave(data: number[], ver: number): number[] {
  const numBlocks = NUM_BLOCKS[ver];
  const eccLen = ECC_PER_BLOCK[ver];
  const raw = Math.floor(rawDataModules(ver) / 8);
  const numShort = numBlocks - (raw % numBlocks);
  const shortLen = Math.floor(raw / numBlocks);
  const div = rsDivisor(eccLen);
  const blocks: number[][] = [];
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const dat = data.slice(k, k + shortLen - eccLen + (i < numShort ? 0 : 1));
    k += dat.length;
    const ecc = rsRemainder(dat, div);
    if (i < numShort) dat.push(0);
    blocks.push(dat.concat(ecc));
  }
  const out: number[] = [];
  for (let i = 0; i < blocks[0].length; i++) {
    blocks.forEach((blk, j) => {
      if (i !== shortLen - eccLen || j >= numShort) out.push(blk[i]);
    });
  }
  return out;
}

// ---------- Matriz ----------

class Builder {
  size: number;
  modules: boolean[][];
  isFn: boolean[][];
  constructor(public ver: number) {
    this.size = ver * 4 + 17;
    this.modules = Array.from({ length: this.size }, () => new Array<boolean>(this.size).fill(false));
    this.isFn = Array.from({ length: this.size }, () => new Array<boolean>(this.size).fill(false));
  }
  setFn(x: number, y: number, dark: boolean) {
    this.modules[y][x] = dark;
    this.isFn[y][x] = true;
  }
  drawFunctionPatterns() {
    const s = this.size;
    for (let i = 0; i < s; i++) {
      this.setFn(6, i, i % 2 === 0);
      this.setFn(i, 6, i % 2 === 0);
    }
    this.finder(3, 3);
    this.finder(s - 4, 3);
    this.finder(3, s - 4);
    const pos = ALIGN_POS[this.ver];
    const n = pos.length;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) continue;
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) this.setFn(pos[i] + dx, pos[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
        }
      }
    }
    this.drawFormatBits(0); // reserva; se sobrescribe con la máscara elegida
    this.drawVersion();
  }
  finder(x: number, y: number) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const xx = x + dx;
        const yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= this.size || yy >= this.size) continue;
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        this.setFn(xx, yy, d !== 2 && d !== 4);
      }
    }
  }
  drawFormatBits(mask: number) {
    const data = (ECC_FORMAT_BITS_M << 3) | mask;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412;
    const bit = (i: number) => ((bits >>> i) & 1) !== 0;
    const s = this.size;
    for (let i = 0; i <= 5; i++) this.setFn(8, i, bit(i));
    this.setFn(8, 7, bit(6));
    this.setFn(8, 8, bit(7));
    this.setFn(7, 8, bit(8));
    for (let i = 9; i < 15; i++) this.setFn(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) this.setFn(s - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) this.setFn(8, s - 15 + i, bit(i));
    this.setFn(8, s - 8, true); // módulo oscuro fijo
  }
  drawVersion() {
    if (this.ver < 7) return;
    let rem = this.ver;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (this.ver << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const dark = ((bits >>> i) & 1) !== 0;
      const a = this.size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      this.setFn(a, b, dark);
      this.setFn(b, a, dark);
    }
  }
  drawCodewords(data: number[]) {
    const s = this.size;
    let i = 0;
    for (let right = s - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < s; vert++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? s - 1 - vert : vert;
          if (!this.isFn[y][x] && i < data.length * 8) {
            this.modules[y][x] = ((data[i >>> 3] >>> (7 - (i & 7))) & 1) !== 0;
            i++;
          }
        }
      }
    }
  }
  applyMask(mask: number) {
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        if (!this.isFn[y][x] && maskBit(mask, x, y)) this.modules[y][x] = !this.modules[y][x];
      }
    }
  }
}

export function maskBit(mask: number, x: number, y: number): boolean {
  switch (mask) {
    case 0: return (x + y) % 2 === 0;
    case 1: return y % 2 === 0;
    case 2: return x % 3 === 0;
    case 3: return (x + y) % 3 === 0;
    case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
    case 5: return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6: return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    default: return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
  }
}

/** Penalización estándar (ISO 18004, reglas N1–N4). */
function penalty(m: boolean[][]): number {
  const s = m.length;
  let score = 0;
  const line = (get: (i: number) => boolean) => {
    let run = 1;
    for (let i = 1; i <= s; i++) {
      if (i < s && get(i) === get(i - 1)) run++;
      else {
        if (run >= 5) score += 3 + (run - 5);
        run = 1;
      }
    }
    // N3: 1:1:3:1:1 con 4 claros a un lado
    for (let i = 0; i + 11 <= s; i++) {
      const p = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
      let a = true;
      let b = true;
      for (let k = 0; k < 11; k++) {
        const v = get(i + k) ? 1 : 0;
        if (v !== p[k]) a = false;
        if (v !== p[10 - k]) b = false;
      }
      if (a) score += 40;
      if (b) score += 40;
    }
  };
  for (let y = 0; y < s; y++) line((i) => m[y][i]);
  for (let x = 0; x < s; x++) line((i) => m[i][x]);
  for (let y = 0; y < s - 1; y++) {
    for (let x = 0; x < s - 1; x++) {
      const c = m[y][x];
      if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) score += 3;
    }
  }
  let dark = 0;
  for (const row of m) for (const v of row) if (v) dark++;
  const total = s * s;
  score += Math.floor(Math.abs(dark * 20 - total * 10) / total) * 10;
  return score;
}

/** Codifica `text` (UTF-8) como QR nivel M. `mask` fuerza una máscara (0–7); por defecto se elige la de menor penalización. */
export function encodeQr(text: string, mask?: number): QrMatrix {
  const bytes = new TextEncoder().encode(text);
  let ver = 1;
  while (ver <= MAX_VERSION && 4 + (ver <= 9 ? 8 : 16) + bytes.length * 8 > dataCodewords(ver) * 8) ver++;
  if (ver > MAX_VERSION) throw new Error('Texto demasiado largo para el QR');
  const codewords = addEccAndInterleave(encodeData(bytes, ver), ver);
  const b = new Builder(ver);
  b.drawFunctionPatterns();
  b.drawCodewords(codewords);
  let best = mask ?? 0;
  if (mask === undefined) {
    let bestScore = Infinity;
    for (let k = 0; k < 8; k++) {
      b.applyMask(k);
      b.drawFormatBits(k);
      const sc = penalty(b.modules);
      if (sc < bestScore) { bestScore = sc; best = k; }
      b.applyMask(k); // deshacer (XOR)
    }
  }
  b.applyMask(best);
  b.drawFormatBits(best);
  return { version: ver, size: b.size, mask: best, modules: b.modules };
}

/** Trazado SVG (atributo `d`) de los módulos oscuros, desplazado `margin` módulos. Une rachas horizontales. */
export function qrPath(qr: QrMatrix, margin = 4): string {
  let d = '';
  qr.modules.forEach((row, y) => {
    for (let x = 0; x < qr.size; x++) {
      if (!row[x]) continue;
      let w = 1;
      while (x + w < qr.size && row[x + w]) w++;
      d += `M${x + margin} ${y + margin}h${w}v1h-${w}z`;
      x += w - 1;
    }
  });
  return d;
}

/** SVG completo (cadena) con zona de silencio de 4 módulos. */
export function qrSvg(text: string, opts: { dark?: string; light?: string } = {}): string {
  const qr = encodeQr(text);
  const n = qr.size + 8;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges">` +
    `<rect width="${n}" height="${n}" fill="${opts.light ?? '#fff'}"/>` +
    `<path d="${qrPath(qr)}" fill="${opts.dark ?? '#000'}"/></svg>`;
}
