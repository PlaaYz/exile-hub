// Atlas tree planner: GGG's official atlas data and art (built into data.json / ruthless.json and img/
// by scripts/atlas-build.mts, texts already in Portuguese), drawn on a canvas like the game.
// Node: [id, x, y, kind, mechanic, sx, sy, sw, sh] kind 0 small, 1 notable, 2 keystone, 3 start, 4 gateway;
//   mechanic = index in T.mechanics or -1; s* = icon on the skills sheet (the start: group-background sheet).
// Mastery: [x, y, mechanic, sx, sy, sw, sh] (the icon in the middle of a mechanic's cluster).
// Edge: [a, b] straight, [a, b, r, sweep] arc, [a, b, -1] two gateways (linked, not drawn).
// Info: id -> { n: name (English, like the game), pt / en: { s: stats, r: reminder, f: flavour, v: variants } }.
"use strict";
const $ = (id) => document.getElementById(id);
const canvas = $("map");
const ctx = canvas.getContext("2d");
const tip = $("tip");
// sprites are for zoom 0.5: their size in the world is twice their pixels
const S = 2;
const HIT = [40, 56, 76, 110, 76]; // click radius in world units, by kind
// the colour at the edges of GGG's atlas background picture: the space around it uses it, so no seam shows
const EDGE = "#0a0b14"; // the background picture's own edge colour (sampled)

const img = {};
for (const [key, file] of Object.entries({
  on: "atlas-skills-4.webp",
  off: "atlas-skills-disabled-4.webp",
  frame: "atlas-frame-4.webp",
  group: "atlas-group-background-4.webp",
  mastery: "atlas-mastery-4.webp",
  bg: "atlas-background-4.webp",
})) {
  img[key] = new Image();
  img[key].onload = () => buildCache();
  img[key].src = "img/" + file;
}

let T = null;
let tree = "data";
let byId = new Map(); // id -> { id, x, y, k, icon: [sx, sy, sw, sh] }
let adj = new Map();
let lines = []; // { a, b, r, sweep }
let bounds = null;
const picked = new Set();
const choice = new Map(); // node with variants -> chosen index
let view = { x: 0, y: 0, w: 1, h: 1 };
let hover = null;
let preview = null; // { add: Set } or { remove: Set }
let hits = [];
let hitAt = -1;
let showBg = true;
try { showBg = localStorage.getItem("exile-hub.atlas.bg") !== "0"; } catch { /* storage blocked */ }
let focus = -1; // highlighted mechanic (index in T.mechanics)
// language of the node texts (names stay in English, like the game), remembered in this browser
let L = "pt";
try { if (localStorage.getItem("exile-hub.atlas.lang") === "en") L = "en"; } catch { /* storage blocked */ }
const texts = (id) => T.info[id]?.[L];

// ---- loading ----------------------------------------------------------------------------

async function load(name, saved) {
  const res = await fetch(`${name}.json?v=5`); // same number as atlas.js?v= in index.html
  T = await res.json();
  tree = name;
  $("ver").textContent = T.version;
  for (const b of document.querySelectorAll("[data-tree]")) b.classList.toggle("on", b.dataset.tree === name);
  layout(); // the header may have wrapped to another height once its text and fonts arrived
  build();
  picked.clear();
  choice.clear();
  focus = -1;
  if (saved) restore(saved);
  setView(fit());
  buildCache();
  changed();
}

function build() {
  byId = new Map();
  adj = new Map();
  lines = [];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [id, x, y, k, m, ...icon] of T.nodes) {
    byId.set(id, { id, x, y, k, m, icon });
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  bounds = { x0, y0, x1, y1 };
  const link = (a, b) => {
    if (!adj.has(a)) adj.set(a, new Set());
    adj.get(a).add(b);
  };
  for (const [a, b, r, sweep] of T.edges) {
    if (!byId.has(a) || !byId.has(b)) continue;
    link(a, b);
    link(b, a);
    if (r !== -1) lines.push({ a, b, r, sweep });
  }
}

// ---- view: zoom and pan -----------------------------------------------------------------

const box = () => canvas.getBoundingClientRect();
const MIN_W = 500, MAX_W = 60000;

function setView(v) {
  view = v;
  $("pct").textContent = Math.round(((box().width || innerWidth) / view.w) * 1000) / 10 + "%";
  draw();
}

// zoom and "show this node" glide to their target instead of jumping
let anim = null;
function animateTo(v, ms = 180) {
  anim = { from: { ...view }, to: v, t0: performance.now(), ms };
  requestAnimationFrame(step);
}
function step(now) {
  if (!anim) return;
  const t = Math.min(1, (now - anim.t0) / anim.ms);
  const e = 1 - Math.pow(1 - t, 3);
  const { from, to } = anim;
  setView({ x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e, w: from.w + (to.w - from.w) * e, h: from.h + (to.h - from.h) * e });
  if (t < 1) requestAnimationFrame(step);
  else anim = null;
}
const stopMotion = () => { anim = null; glide = null; };

function fit() {
  const { x0, y0, x1, y1 } = bounds;
  const pad = 500;
  const w = x1 - x0 + 2 * pad, h = y1 - y0 + 2 * pad;
  const r = box();
  const width = r.width || innerWidth;
  const height = r.height || innerHeight - 60;
  // the side panel covers the right of the map on wide screens, the bottom on phones
  const open = !$("panel").classList.contains("hidden");
  const side = innerWidth > 700 && open ? $("panel").offsetWidth : 0;
  const below = innerWidth <= 700 && open ? $("panel").offsetHeight : 0;
  const aspect = (width - side) / Math.max(1, height - below);
  const v = w / h > aspect ? { x: x0 - pad, w, h: w / aspect } : { y: y0 - pad, h, w: h * aspect };
  v.x ??= (x0 + x1) / 2 - v.w / 2;
  v.y ??= (y0 + y1) / 2 - v.h / 2;
  v.w *= width / (width - side);
  v.h *= height / (height - below);
  return v;
}

function toWorld(cx, cy) {
  const r = box();
  return [view.x + ((cx - r.left) / r.width) * view.w, view.y + ((cy - r.top) / r.height) * view.h];
}

/** `base` zoomed by `factor` around a screen point (that point stays under the cursor). */
function zoomed(base, factor, cx, cy) {
  const r = box();
  const fx = (cx - r.left) / r.width, fy = (cy - r.top) / r.height;
  const w = Math.min(MAX_W, Math.max(MIN_W, base.w / factor));
  const h = (base.h * w) / base.w;
  return { x: base.x + (base.w - w) * fx, y: base.y + (base.h - h) * fy, w, h };
}

// quick wheel turns add up: each one zooms from where the glide is heading
function zoomAt(factor, cx, cy) {
  glide = null;
  animateTo(zoomed(anim ? anim.to : view, factor, cx, cy));
}

function centerOn(n) {
  const w = Math.min(view.w, 5000), h = (view.h * w) / view.w;
  animateTo({ x: n.x - w / 2, y: n.y - h / 2, w, h }, 300);
}

const center = () => {
  const r = box();
  return [r.left + r.width / 2, r.top + r.height / 2];
};

// ---- drawing ------------------------------------------------------------------------------
// Everything that never changes (background, group art, links, every node as unallocated) is drawn
// once into a big picture of the whole tree; zoomed out, a frame is that picture plus the few
// allocated / highlighted nodes on top. Zoomed in, only what is on screen is drawn.

let pending = false;
function draw() {
  if (pending) return;
  pending = true;
  requestAnimationFrame(render);
}

const ready = (im) => im.complete && im.naturalWidth > 0;

/** A sprite centred on (x, y) at its world size. */
function sprite(g, im, r, x, y) {
  if (!r || !ready(im)) return;
  const w = r[2] * S, h = r[3] * S;
  g.drawImage(im, r[0], r[1], r[2], r[3], x - w / 2, y - h / 2, w, h);
}

const FRAME = {
  0: { off: "PSSkillFrame", on: "PSSkillFrameActive", next: "PSSkillFrameHighlighted" },
  1: { off: "NotableFrameUnallocated", on: "NotableFrameAllocated", next: "NotableFrameCanAllocate" },
  2: { off: "KeystoneFrameUnallocated", on: "KeystoneFrameAllocated", next: "KeystoneFrameCanAllocate" },
  4: { off: "WormholeFrameUnallocated", on: "WormholeFrameAllocated", next: "WormholeFrameCanAllocate" },
};

/** The round atlas background: centred on the start, framing the whole tree. */
function bgSquare() {
  const s = byId.get(T.start);
  const { x0, y0, x1, y1 } = bounds;
  const size = 2.25 * Math.max(s.x - x0, x1 - s.x, s.y - y0, y1 - s.y);
  return { x: s.x - size / 2, y: s.y - size / 2, size };
}

/** Links whose ends pass `test`, as one path. */
function linkPath(g, test) {
  g.beginPath();
  for (const l of lines) {
    if (!test(l.a, l.b)) continue;
    const p = byId.get(l.a), q = byId.get(l.b);
    g.moveTo(p.x, p.y);
    if (l.r) {
      // arc around the group centre: endpoints, radius and direction
      const mx = (p.x + q.x) / 2, my = (p.y + q.y) / 2;
      const half = Math.hypot(q.x - p.x, q.y - p.y) / 2;
      const d = Math.sqrt(Math.max(0, l.r * l.r - half * half));
      const nx = -(q.y - p.y) / (2 * half || 1), ny = (q.x - p.x) / (2 * half || 1);
      const sgn = l.sweep ? 1 : -1;
      const cx = mx + nx * d * sgn, cy = my + ny * d * sgn;
      g.arc(cx, cy, l.r, Math.atan2(p.y - cy, p.x - cx), Math.atan2(q.y - cy, q.x - cx), !l.sweep);
    } else g.lineTo(q.x, q.y);
  }
}

const lineWidth = (k) => Math.max(14, 1.6 / k);

/** The unchanging layer. `rect` = only what is inside it (zoomed in), null = everything. */
function drawStatic(g, k, rect) {
  const inside = rect ? (x, y, m) => x + m > rect.x && x - m < rect.x + rect.w && y + m > rect.y && y - m < rect.y + rect.h : () => true;
  const b = T.sprites.background;
  if (b && showBg && ready(img.bg)) {
    const sq = bgSquare();
    // only the part of the (5184 px) picture that is on screen
    const x0 = Math.max(sq.x, rect ? rect.x : sq.x), y0 = Math.max(sq.y, rect ? rect.y : sq.y);
    const x1 = Math.min(sq.x + sq.size, rect ? rect.x + rect.w : Infinity), y1 = Math.min(sq.y + sq.size, rect ? rect.y + rect.h : Infinity);
    if (x1 > x0 && y1 > y0) {
      const f = b[2] / sq.size;
      g.drawImage(img.bg, b[0] + (x0 - sq.x) * f, b[1] + (y0 - sq.y) * f, (x1 - x0) * f, (y1 - y0) * f, x0, y0, x1 - x0, y1 - y0);
    }
  }
  for (const [x, y, ...r] of T.groups) if (inside(x, y, r[2] * S)) sprite(g, img.group, r, x, y);
  g.strokeStyle = "#8a7450";
  g.lineWidth = lineWidth(k);
  // a link is skipped when both ends are far off screen (arcs bulge at most ~900 units)
  const near = (id) => { const n = byId.get(id); return inside(n.x, n.y, 900); };
  linkPath(g, rect ? (a, b) => near(a) || near(b) : () => true);
  g.stroke();
  g.globalAlpha = 0.85;
  for (const [x, y, , ...r] of T.masteries) if (inside(x, y, r[2] * S)) sprite(g, img.mastery, r, x, y);
  g.globalAlpha = 1;
  for (const n of byId.values()) {
    if (!inside(n.x, n.y, 160)) continue;
    if (n.k === 3) { sprite(g, img.group, n.icon, n.x, n.y); continue; }
    sprite(g, img.off, n.icon, n.x, n.y);
    sprite(g, img.frame, T.sprites.frames[FRAME[n.k].off], n.x, n.y);
  }
}

let cache = null; // { canvas, x, y, size, k }
function buildCache() {
  cache = null;
  if (!T || !Object.values(img).every(ready)) return;
  const sq = bgSquare();
  // phones limit how big a canvas can be
  const px = innerWidth <= 700 ? 2048 : 3072;
  const c = document.createElement("canvas");
  c.width = c.height = px;
  const k = px / sq.size;
  const g = c.getContext("2d");
  g.imageSmoothingQuality = "high";
  g.setTransform(k, 0, 0, k, -sq.x * k, -sq.y * k);
  drawStatic(g, k, null);
  cache = { canvas: c, ...sq, k };
  draw();
}

function render() {
  pending = false;
  if (!T) return;
  const dpr = devicePixelRatio || 1;
  const r = box();
  if (canvas.width !== Math.round(r.width * dpr) || canvas.height !== Math.round(r.height * dpr)) {
    canvas.width = Math.round(r.width * dpr);
    canvas.height = Math.round(r.height * dpr);
  }
  const k = canvas.width / view.w; // device pixels per world unit
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = EDGE;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(k, 0, 0, k, -view.x * k, -view.y * k);
  ctx.imageSmoothingQuality = "high";

  // the picture while it is at least as sharp as the screen needs (25% leeway)
  if (cache && k <= cache.k * 1.25) ctx.drawImage(cache.canvas, cache.x, cache.y, cache.size, cache.size);
  else drawStatic(ctx, k, view);

  // a highlighted mechanic: everything else dimmed, its nodes and mastery icon redrawn bright
  if (focus >= 0) {
    ctx.fillStyle = "rgba(6,7,10,.68)";
    ctx.fillRect(view.x, view.y, view.w, view.h);
    for (const [x, y, m, ...r] of T.masteries) if (m === focus) sprite(ctx, img.mastery, r, x, y);
    for (const n of byId.values()) {
      if (n.m !== focus || picked.has(n.id)) continue;
      sprite(ctx, img.off, n.icon, n.x, n.y);
      sprite(ctx, img.frame, T.sprites.frames[FRAME[n.k].off], n.x, n.y);
    }
  }

  // what changes: allocated nodes and links, the path a click would add, highlights
  const on = (id) => id === T.start || picked.has(id);
  const soon = preview?.add ?? new Set();
  const cut = preview?.remove ?? new Set();
  ctx.lineWidth = lineWidth(k) * 2.2; // stands out from the brighter unallocated links
  ctx.strokeStyle = "#ffd76a";
  linkPath(ctx, (a, b) => on(a) && on(b));
  ctx.stroke();
  if (soon.size) {
    ctx.strokeStyle = "#8fd080";
    linkPath(ctx, (a, b) => (on(a) || soon.has(a)) && (on(b) || soon.has(b)) && (soon.has(a) || soon.has(b)));
    ctx.stroke();
  }
  const lit = new Set([...picked, ...soon]);
  if (hover != null) lit.add(hover);
  for (const id of lit) {
    const n = byId.get(id);
    if (!n || n.k === 3) continue;
    const active = picked.has(id);
    sprite(ctx, active ? img.on : img.off, n.icon, n.x, n.y);
    sprite(ctx, img.frame, T.sprites.frames[active ? FRAME[n.k].on : FRAME[n.k].next], n.x, n.y);
  }
  const start = byId.get(T.start);
  if (lit.size || cut.size) sprite(ctx, img.group, start.icon, start.x, start.y); // above the gold links

  // rings: removal preview, choice still to make, search results
  const ring = (n, color, gap) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(10, 3 / k);
    ctx.beginPath();
    ctx.arc(n.x, n.y, HIT[n.k] + gap, 0, Math.PI * 2);
    ctx.stroke();
  };
  for (const id of cut) ring(byId.get(id), "#f0716b", 6);
  for (const id of picked) if (texts(id)?.v && !choice.has(id)) ring(byId.get(id), "#e07a30", 6);
  hits.forEach((id, i) => ring(byId.get(id), i === hitAt ? "#ffffff" : "#4fc3ff", 14));
}

// ---- allocation ---------------------------------------------------------------------------

/** The nodes to add to reach n from what is allocated (shortest), or null. */
function pathTo(id) {
  const prev = new Map();
  const queue = [T.start, ...picked];
  for (const q of queue) prev.set(q, null);
  for (let i = 0; i < queue.length && !prev.has(id); i++) {
    for (const next of adj.get(queue[i]) ?? []) if (!prev.has(next)) { prev.set(next, queue[i]); queue.push(next); }
  }
  if (!prev.has(id)) return null;
  const path = [];
  for (let at = id; at !== T.start && !picked.has(at); at = prev.get(at)) path.push(at);
  return path.reverse();
}

/** What stays linked to the start when `without` is removed. */
function reachable(without) {
  const seen = new Set([T.start]);
  const stack = [T.start];
  while (stack.length) {
    for (const next of adj.get(stack.pop()) ?? []) {
      if (next !== without && picked.has(next) && !seen.has(next)) { seen.add(next); stack.push(next); }
    }
  }
  return seen;
}

const removing = (id) => { const keep = reachable(id); return [...picked].filter((p) => !keep.has(p)); };

function previewFor(id) {
  if (id == null || id === T.start) return null;
  if (picked.has(id)) return { remove: new Set(removing(id)) };
  const path = pathTo(id);
  return path ? { add: new Set(path) } : null;
}

function click(id) {
  if (id === T.start) return;
  if (picked.has(id)) {
    for (const p of removing(id)) { picked.delete(p); choice.delete(p); }
  } else {
    const path = pathTo(id);
    if (!path || picked.size + path.length > T.points) return;
    for (const p of path) picked.add(p);
  }
  changed();
}

function changed() {
  preview = previewFor(hover);
  draw();
  panel();
  const ids = [...picked].map((id) => (choice.has(id) ? `${id}.${choice.get(id)}` : id)).join(",");
  history.replaceState(null, "", `#${tree}${ids ? ":" + ids : ""}`);
}

function restore(saved) {
  for (const item of saved.split(",")) {
    const [id, c] = item.split(".").map(Number);
    if (!byId.has(id) || picked.size >= T.points) continue;
    picked.add(id);
    if (texts(id)?.v?.[c]) choice.set(id, c);
  }
  // drop anything a hand-edited link left floating
  const keep = reachable(null);
  for (const p of [...picked]) if (!keep.has(p)) picked.delete(p);
}

// ---- side panel ---------------------------------------------------------------------------

const NUM = /\d+(?:\.\d+)?/g;

/** Same effect from several nodes adds up when it has a single number ("2% increased..." x3 = 6%). */
function effectsOf() {
  const groups = new Map();
  for (const id of picked) {
    const t = texts(id);
    if (!t) continue;
    const stats = t.v ? (choice.has(id) ? t.v[choice.get(id)] : []) : t.s;
    for (const s of stats) {
      const key = s.replace(NUM, "#");
      const nums = (s.match(NUM) ?? []).map(Number);
      const g = groups.get(key);
      if (!g) groups.set(key, { text: s, nums, count: 1 });
      else { g.count++; if (nums.length === 1) g.nums[0] += nums[0]; }
    }
  }
  return [...groups.values()]
    .map((g) => (g.count > 1 && g.nums.length === 1 ? { ...g, text: g.text.replace(NUM, String(Math.round(g.nums[0] * 100) / 100)) } : g))
    .sort((a, b) => a.text.localeCompare(b.text, L === "pt" ? "pt-BR" : "en"));
}

function panel() {
  const pts = $("points");
  pts.textContent = `${picked.size} / ${T.points} pontos`;
  pts.classList.toggle("full", picked.size >= T.points);
  $("count").textContent = `${picked.size} / ${T.points} selecionados`;
  $("count").classList.toggle("full", picked.size >= T.points);
  $("empty").style.display = picked.size ? "none" : "";

  const eff = $("effects");
  eff.textContent = "";
  for (const e of effectsOf()) {
    const li = document.createElement("li");
    li.textContent = e.text;
    if (e.count > 1) {
      const k = document.createElement("span");
      k.className = "x";
      k.textContent = "×" + e.count;
      li.append(k);
    }
    eff.append(li);
  }

  // keystones, notables and gateways one by one; small nodes grouped by name
  const list = $("picked");
  list.textContent = "";
  const small = new Map();
  const big = [];
  for (const id of picked) {
    const n = byId.get(id);
    if (n.k === 0) small.set(T.info[id].n, [...(small.get(T.info[id].n) ?? []), n]);
    else big.push(n);
  }
  big.sort((a, b) => b.k - a.k || T.info[a.id].n.localeCompare(T.info[b.id].n));
  for (const n of big) {
    const variants = texts(n.id)?.v;
    const li = document.createElement("li");
    const name = document.createElement("span");
    name.className = "name k" + n.k;
    name.textContent = T.info[n.id].n;
    name.title = "Mostrar na árvore";
    name.onclick = () => centerOn(n);
    li.append(name);
    if (variants) {
      const sel = document.createElement("select");
      sel.title = "Escolha deste nó";
      if (!choice.has(n.id)) sel.append(new Option("Escolha um…", "", true, true));
      variants.forEach((stats, i) => sel.append(new Option(stats.join(" / "), String(i), false, choice.get(n.id) === i)));
      sel.onchange = () => { choice.set(n.id, Number(sel.value)); changed(); };
      li.append(sel);
    }
    list.append(li);
  }
  for (const [label, nodes] of [...small].sort((a, b) => a[0].localeCompare(b[0]))) {
    const li = document.createElement("li");
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = label;
    name.onclick = () => centerOn(nodes[0]);
    li.append(name);
    if (nodes.length > 1) {
      const k = document.createElement("span");
      k.className = "x";
      k.textContent = "×" + nodes.length;
      li.append(k);
    }
    list.append(li);
  }
  mechList();
  buildList();
}

// ---- mechanics: allocated / total per mechanic; a click (or on its icon in the tree) highlights it --

function setFocus(m) {
  focus = focus === m ? -1 : m;
  mechList();
  draw();
}

function mechList() {
  const total = T.mechanics.map(() => 0), mine = T.mechanics.map(() => 0);
  for (const n of byId.values()) if (n.m >= 0 && n.k !== 4) { total[n.m]++; if (picked.has(n.id)) mine[n.m]++; }
  const list = $("mechs");
  list.textContent = "";
  T.mechanics
    .map((name, m) => ({ name, m }))
    .filter((x) => total[x.m])
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach(({ name, m }) => {
      const li = document.createElement("li");
      li.className = (focus === m ? "focus" : "") + (mine[m] ? " some" : "");
      li.title = "Destacar na árvore";
      li.onclick = () => setFocus(m);
      const span = document.createElement("span");
      span.className = "name";
      span.textContent = name;
      const k = document.createElement("span");
      k.className = "x";
      k.textContent = `${mine[m]}/${total[m]}`;
      li.append(span, k);
      list.append(li);
    });
}

/** The mastery icon under the pointer: its mechanic, or -1. */
function masteryAt(cx, cy) {
  const [wx, wy] = toWorld(cx, cy);
  for (const [x, y, m, , , w] of T.masteries) if (m >= 0 && Math.hypot(x - wx, y - wy) < (w * S) / 2) return m;
  return -1;
}

// ---- saved builds (this browser only) ---------------------------------------------------------

const BUILDS = "exile-hub.atlas.builds";
function builds() {
  try { return JSON.parse(localStorage.getItem(BUILDS) ?? "[]"); } catch { return []; }
}
function storeBuilds(list) {
  try { localStorage.setItem(BUILDS, JSON.stringify(list)); } catch { alert("Este navegador não deixou salvar."); }
  buildList();
}

let buildName = ""; // the saved tree last loaded or saved (preselected in the list)

function buildList() {
  const sel = $("builds");
  const mine = builds().filter((b) => b.tree === tree);
  if (!mine.some((b) => b.name === buildName)) buildName = "";
  sel.textContent = "";
  sel.append(new Option(mine.length ? "Builds salvas…" : "Nenhuma build salva", "", true, !buildName));
  for (const b of mine) sel.append(new Option(b.name, b.name, false, b.name === buildName));
  $("del").disabled = !buildName;
}

$("builds").onchange = () => {
  const b = builds().find((x) => x.tree === tree && x.name === $("builds").value);
  buildName = b ? b.name : "";
  if (b) load(tree, b.ids);
  else buildList();
};
$("save").onclick = () => {
  if (!picked.size) { alert("Selecione algum nó antes de salvar."); return; }
  const name = prompt("Nome desta build:", buildName)?.trim();
  if (!name) return;
  const ids = location.hash.split(":")[1] ?? "";
  buildName = name;
  // same name on the same tree = overwrite
  storeBuilds([...builds().filter((b) => !(b.tree === tree && b.name === name)), { tree, name, ids }]);
};
$("del").onclick = () => {
  if (!buildName || !confirm(`Excluir a build "${buildName}"?`)) return;
  const name = buildName;
  buildName = "";
  storeBuilds(builds().filter((b) => !(b.tree === tree && b.name === name)));
};

// ---- tooltip ------------------------------------------------------------------------------

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

function showTip(id, x, y) {
  const t = texts(id);
  if (!t) { tip.style.display = "none"; return; }
  const name = T.info[id].n, { s: stats, r: rem, f: flav, v: variants } = t;
  let html = `<b>${esc(name)}</b>` + stats.map((s) => `<div class="s">${esc(s)}</div>`).join("");
  if (variants) {
    html += `<div class="v">${L === "pt" ? "Escolha uma opção:" : "Choose one:"}` +
      variants.map((v, i) => `<div${choice.get(id) === i ? ' class="on"' : ""}>${v.map(esc).join("<br>")}</div>`).join("") + "</div>";
  }
  html += rem.map((s) => `<div class="r">${esc(s)}</div>`).join("");
  if (flav.length) html += `<div class="f">${flav.map(esc).join("<br>")}</div>`;
  if (preview?.remove) {
    const k = preview.remove.size;
    html += `<div class="h bad">Clique para remover${k > 1 ? ` (${k} nós: este e os que dependem dele)` : ""}</div>`;
  } else if (preview?.add) {
    const k = preview.add.size, left = T.points - picked.size;
    html += k > left
      ? `<div class="h bad">O caminho precisa de ${k} pontos e só restam ${left}</div>`
      : `<div class="h">Clique para alocar (${k} ${k === 1 ? "ponto" : "pontos"})${variants ? "; depois escolha a opção no painel" : ""}</div>`;
  }
  tip.innerHTML = html;
  tip.style.display = "block";
  const r = tip.getBoundingClientRect();
  tip.style.left = Math.max(8, Math.min(x + 16, innerWidth - r.width - 8)) + "px";
  tip.style.top = Math.max(8, Math.min(y + 16, innerHeight - r.height - 8)) + "px";
}

// ---- mouse / touch ------------------------------------------------------------------------

/** The node under the pointer, if any. */
function nodeAt(cx, cy) {
  const [wx, wy] = toWorld(cx, cy);
  let best = null, bestD = Infinity;
  for (const n of byId.values()) {
    const d = Math.hypot(n.x - wx, n.y - wy);
    if (d < HIT[n.k] && d < bestD) { best = n; bestD = d; }
  }
  return best ? best.id : null;
}

// one finger / the mouse drags (and keeps sliding a little when let go), two fingers pinch
const pointers = new Map(); // pointerId -> { x, y }
let drag = null;
let pinch = null;
let glide = null; // { vx, vy } in screen px per ms

function startGlide() {
  let last = performance.now();
  const tick = (now) => {
    if (!glide) return;
    const dt = Math.min(40, now - last);
    last = now;
    const s = view.w / box().width;
    setView({ ...view, x: view.x - glide.vx * dt * s, y: view.y - glide.vy * dt * s });
    glide.vx *= Math.pow(0.994, dt);
    glide.vy *= Math.pow(0.994, dt);
    if (Math.hypot(glide.vx, glide.vy) < 0.02) glide = null;
    else requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

canvas.addEventListener("pointerdown", (e) => {
  stopMotion();
  try { canvas.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, view: { ...view } };
    drag = null;
    tip.style.display = "none";
  } else if (pointers.size === 1) {
    drag = { x0: e.clientX, y0: e.clientY, moved: false, view: { ...view }, track: [{ x: e.clientX, y: e.clientY, t: e.timeStamp }] };
  }
});

canvas.addEventListener("pointermove", (e) => {
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pinch && pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const v = zoomed(pinch.view, dist / Math.max(1, pinch.dist), pinch.mx, pinch.my);
    const s = v.w / box().width;
    setView({ ...v, x: v.x - (mx - pinch.mx) * s, y: v.y - (my - pinch.my) * s });
    return;
  }
  if (drag) {
    if (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 5) return;
    drag.moved = true;
    canvas.classList.add("drag");
    tip.style.display = "none";
    drag.track.push({ x: e.clientX, y: e.clientY, t: e.timeStamp });
    if (drag.track.length > 5) drag.track.shift();
    const s = view.w / box().width;
    setView({ ...drag.view, x: drag.view.x - (e.clientX - drag.x0) * s, y: drag.view.y - (e.clientY - drag.y0) * s });
    return;
  }
  if (e.pointerType !== "mouse") return;
  const id = nodeAt(e.clientX, e.clientY);
  canvas.classList.toggle("over", id != null);
  if (id !== hover) { hover = id; preview = previewFor(id); draw(); }
  if (id != null) showTip(id, e.clientX, e.clientY);
  else tip.style.display = "none";
});

function release(e) {
  pointers.delete(e.pointerId);
  if (pinch) {
    // lifting one finger of a pinch neither clicks nor slides
    if (pointers.size < 2) pinch = null;
    drag = null;
    return;
  }
  const d = drag;
  drag = null;
  canvas.classList.remove("drag");
  if (!d || e.type === "pointercancel") return;
  if (d.moved) {
    const first = d.track[0], last = d.track[d.track.length - 1];
    const dt = last.t - first.t;
    if (dt > 0 && e.timeStamp - last.t < 80) {
      glide = { vx: (last.x - first.x) / dt, vy: (last.y - first.y) / dt };
      startGlide();
    }
    return;
  }
  const id = nodeAt(e.clientX, e.clientY);
  if (id != null) {
    if (e.pointerType !== "mouse") { hover = id; preview = previewFor(id); }
    click(id);
    showTip(id, e.clientX, e.clientY);
  } else {
    if (e.pointerType !== "mouse") tip.style.display = "none";
    const m = masteryAt(e.clientX, e.clientY);
    if (m >= 0) setFocus(m);
  }
}
canvas.addEventListener("pointerup", release);
canvas.addEventListener("pointercancel", release);
canvas.addEventListener("pointerleave", (e) => {
  if (e.pointerType !== "mouse") return;
  tip.style.display = "none";
  if (hover != null) { hover = null; preview = null; draw(); }
});
canvas.addEventListener("wheel", (e) => { e.preventDefault(); zoomAt(Math.pow(1.0018, -e.deltaY), e.clientX, e.clientY); }, { passive: false });

$("in").onclick = () => zoomAt(1.4, ...center());
$("out").onclick = () => zoomAt(1 / 1.4, ...center());
$("fit").onclick = () => animateTo(fit(), 300);
$("clear").onclick = () => { picked.clear(); choice.clear(); buildName = ""; changed(); };
$("panelBtn").onclick = () => { $("panel").classList.toggle("hidden"); $("panelBtn").classList.toggle("on"); };
// "Fundo": the round background picture on/off, remembered in this browser
const bgBtn = $("bg");
bgBtn.classList.toggle("on", showBg);
bgBtn.onclick = () => {
  showBg = !showBg;
  try { localStorage.setItem("exile-hub.atlas.bg", showBg ? "1" : "0"); } catch { /* storage blocked */ }
  bgBtn.classList.toggle("on", showBg);
  buildCache();
  draw();
};

const langBtn = $("lang");
const showLang = () => {
  langBtn.textContent = L === "pt" ? "PT" : "EN";
  langBtn.title = L === "pt" ? "Textos dos nós em português (clique para inglês)" : "Node texts in English (click for Portuguese)";
};
showLang();
langBtn.onclick = () => {
  L = L === "pt" ? "en" : "pt";
  try { localStorage.setItem("exile-hub.atlas.lang", L); } catch { /* storage blocked */ }
  showLang();
  tip.style.display = "none";
  panel();
};
for (const b of document.querySelectorAll("[data-tree]")) {
  b.onclick = () => { if (b.dataset.tree !== tree) load(b.dataset.tree, ""); };
}

// ---- search -------------------------------------------------------------------------------

const q = $("q");
function search() {
  const words = q.value.toLowerCase().split(/\s+/).filter(Boolean);
  hits = [];
  hitAt = -1;
  if (words.length) {
    for (const n of byId.values()) {
      const info = T.info[n.id];
      if (!info) continue;
      const text = [info.n, ...["pt", "en"].flatMap((l) => [...info[l].s, ...(info[l].v ?? []).flat()])].join(" ").toLowerCase();
      if (words.every((w) => text.includes(w))) hits.push(n.id);
    }
  }
  $("hits").textContent = words.length ? (hits.length ? `${hits.length} encontrados` : "nada encontrado") : "";
  draw();
}
q.addEventListener("input", search);
q.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && hits.length) {
    hitAt = (hitAt + (e.shiftKey ? hits.length - 1 : 1)) % hits.length;
    $("hits").textContent = `${hitAt + 1} / ${hits.length}`;
    centerOn(byId.get(hits[hitAt]));
  } else if (e.key === "Escape") { q.value = ""; search(); q.blur(); }
});
addEventListener("keydown", (e) => {
  if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
  if (e.key === "+" || e.key === "=") zoomAt(1.4, ...center());
  if (e.key === "-") zoomAt(1 / 1.4, ...center());
  if (e.key === "0") animateTo(fit(), 300);
  if (e.key === "/") { e.preventDefault(); q.focus(); }
});

// ---- layout -------------------------------------------------------------------------------

function layout() {
  const top = document.querySelector("header").offsetHeight;
  canvas.style.top = top + "px";
  canvas.style.height = innerHeight - top + "px";
  if (innerWidth > 700) $("panel").style.top = top + "px";
  if (T) draw();
}
addEventListener("resize", layout);
layout();

// "#data:1,2.0,3" = tree and allocated nodes ("id.choice" for nodes with options)
const m = /^#(data|ruthless)(?::([\d.,]+))?/.exec(location.hash);
if (innerWidth <= 700 && !(m && m[2])) { $("panel").classList.add("hidden"); $("panelBtn").classList.remove("on"); }
load(m ? m[1] : "data", m?.[2] ?? "");
