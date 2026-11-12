// Atlas tree planner: GGG's official atlas data and art (built into data.json / ruthless.json and img/
// by scripts/atlas-build.mts, texts already in Portuguese), drawn on a canvas like the game.
// Node: [id, x, y, kind, sx, sy, sw, sh] kind 0 small, 1 notable, 2 keystone, 3 start, 4 gateway;
//   s* = icon on the skills sheet (the start uses the group-background sheet).
// Edge: [a, b] straight, [a, b, r, sweep] arc, [a, b, -1] two gateways (linked, not drawn).
// Info: id -> [name, stats, reminder, flavour, variants | null, English text for the search].
"use strict";
const $ = (id) => document.getElementById(id);
const canvas = $("map");
const ctx = canvas.getContext("2d");
const tip = $("tip");
// sprites are for zoom 0.5: their size in the world is twice their pixels
const S = 2;
const HIT = [40, 56, 76, 110, 76]; // click radius in world units, by kind

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
  img[key].onload = () => draw();
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

// ---- loading ----------------------------------------------------------------------------

async function load(name, saved) {
  const res = await fetch(`${name}.json`);
  T = await res.json();
  tree = name;
  $("ver").textContent = T.version;
  for (const b of document.querySelectorAll("[data-tree]")) b.classList.toggle("on", b.dataset.tree === name);
  layout(); // the header may have wrapped to another height once its text and fonts arrived
  build();
  picked.clear();
  choice.clear();
  if (saved) restore(saved);
  fit();
  changed();
}

function build() {
  byId = new Map();
  adj = new Map();
  lines = [];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [id, x, y, k, ...icon] of T.nodes) {
    byId.set(id, { id, x, y, k, icon });
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

function setView(v) {
  view = v;
  $("pct").textContent = Math.round(((box().width || innerWidth) / view.w) * 1000) / 10 + "%";
  draw();
}

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
  setView(v);
}

function toWorld(cx, cy) {
  const r = box();
  return [view.x + ((cx - r.left) / r.width) * view.w, view.y + ((cy - r.top) / r.height) * view.h];
}

function zoomAt(factor, cx, cy) {
  const r = box();
  const fx = (cx - r.left) / r.width, fy = (cy - r.top) / r.height;
  const w = Math.min(60000, Math.max(500, view.w / factor));
  const h = (view.h * w) / view.w;
  setView({ x: view.x + (view.w - w) * fx, y: view.y + (view.h - h) * fy, w, h });
}

function centerOn(n) {
  const w = Math.min(view.w, 5000), h = (view.h * w) / view.w;
  setView({ x: n.x - w / 2, y: n.y - h / 2, w, h });
}

const center = () => {
  const r = box();
  return [r.left + r.width / 2, r.top + r.height / 2];
};

// ---- drawing ------------------------------------------------------------------------------

let pending = false;
function draw() {
  if (pending) return;
  pending = true;
  requestAnimationFrame(render);
}

const ready = (im) => im.complete && im.naturalWidth > 0;

/** A sprite centred on (x, y) at its world size (times `scale`). */
function sprite(im, r, x, y, scale = 1) {
  if (!r || !ready(im)) return;
  const w = r[2] * S * scale, h = r[3] * S * scale;
  ctx.drawImage(im, r[0], r[1], r[2], r[3], x - w / 2, y - h / 2, w, h);
}

const FRAME = {
  0: { off: "PSSkillFrame", on: "PSSkillFrameActive", next: "PSSkillFrameHighlighted" },
  1: { off: "NotableFrameUnallocated", on: "NotableFrameAllocated", next: "NotableFrameCanAllocate" },
  2: { off: "KeystoneFrameUnallocated", on: "KeystoneFrameAllocated", next: "KeystoneFrameCanAllocate" },
  4: { off: "WormholeFrameUnallocated", on: "WormholeFrameAllocated", next: "WormholeFrameCanAllocate" },
};

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
  ctx.fillStyle = "#08090c";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(k, 0, 0, k, -view.x * k, -view.y * k);
  ctx.imageSmoothingQuality = "high";

  // the atlas' round background, centred on the start and framing the whole tree
  const start = byId.get(T.start);
  if (T.sprites.background && ready(img.bg)) {
    const { x0, y0, x1, y1 } = bounds;
    const size = 2.25 * Math.max(start.x - x0, x1 - start.x, start.y - y0, y1 - start.y);
    const b = T.sprites.background;
    ctx.globalAlpha = 0.9;
    ctx.drawImage(img.bg, b[0], b[1], b[2], b[3], start.x - size / 2, start.y - size / 2, size, size);
    ctx.globalAlpha = 1;
  }
  for (const [x, y, ...g] of T.groups) sprite(img.group, g, x, y);

  const on = (id) => id === T.start || picked.has(id);
  const soon = preview?.add ?? new Set();
  const cut = preview?.remove ?? new Set();
  // links: dark, gold when both ends are allocated, green for the path a click would add
  const width = Math.max(14, 1.6 / k);
  const pass = (test, color, w) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    ctx.beginPath();
    for (const l of lines) {
      if (!test(l.a, l.b)) continue;
      const p = byId.get(l.a), q = byId.get(l.b);
      ctx.moveTo(p.x, p.y);
      if (l.r) {
        // arc around the group centre: endpoints, radius and direction
        const mx = (p.x + q.x) / 2, my = (p.y + q.y) / 2;
        const half = Math.hypot(q.x - p.x, q.y - p.y) / 2;
        const d = Math.sqrt(Math.max(0, l.r * l.r - half * half));
        const nx = -(q.y - p.y) / (2 * half || 1), ny = (q.x - p.x) / (2 * half || 1);
        const sgn = l.sweep ? 1 : -1;
        const cx = mx + nx * d * sgn, cy = my + ny * d * sgn;
        const a0 = Math.atan2(p.y - cy, p.x - cx), a1 = Math.atan2(q.y - cy, q.x - cx);
        ctx.arc(cx, cy, l.r, a0, a1, !l.sweep);
      } else ctx.lineTo(q.x, q.y);
    }
    ctx.stroke();
  };
  pass(() => true, "#4a3f2c", width);
  pass((a, b) => on(a) && on(b), "#e8c060", width * 1.4);
  if (soon.size) pass((a, b) => (on(a) || soon.has(a)) && (on(b) || soon.has(b)) && (soon.has(a) || soon.has(b)), "#8fd080", width * 1.4);

  ctx.globalAlpha = 0.85;
  for (const [x, y, ...m] of T.masteries) sprite(img.mastery, m, x, y);
  ctx.globalAlpha = 1;

  for (const n of byId.values()) {
    if (n.k === 3) { sprite(img.group, n.icon, n.x, n.y); continue; }
    const active = on(n.id);
    sprite(active ? img.on : img.off, n.icon, n.x, n.y);
    const f = FRAME[n.k];
    sprite(img.frame, T.sprites.frames[active ? f.on : soon.has(n.id) || n.id === hover ? f.next : f.off], n.x, n.y);
  }

  // rings: removal preview, choice still to make, search results
  const ring = (n, color, gap) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(10, 3 / k);
    ctx.beginPath();
    ctx.arc(n.x, n.y, HIT[n.k] + gap, 0, Math.PI * 2);
    ctx.stroke();
  };
  for (const id of cut) ring(byId.get(id), "#f0716b", 6);
  for (const id of picked) if (T.info[id]?.[4] && !choice.has(id)) ring(byId.get(id), "#e07a30", 6);
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
    if (T.info[id]?.[4]?.[c]) choice.set(id, c);
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
    const info = T.info[id];
    if (!info) continue;
    const stats = info[4] ? (choice.has(id) ? info[4][choice.get(id)] : []) : info[1];
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
    .sort((a, b) => a.text.localeCompare(b.text, "pt-BR"));
}

function panel() {
  const pts = $("points");
  pts.textContent = `${picked.size} / ${T.points} pontos`;
  pts.classList.toggle("full", picked.size >= T.points);
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
    if (n.k === 0) small.set(T.info[id][0], [...(small.get(T.info[id][0]) ?? []), n]);
    else big.push(n);
  }
  big.sort((a, b) => b.k - a.k || T.info[a.id][0].localeCompare(T.info[b.id][0]));
  for (const n of big) {
    const info = T.info[n.id];
    const li = document.createElement("li");
    const name = document.createElement("span");
    name.className = "name k" + n.k;
    name.textContent = info[0];
    name.title = "Mostrar na árvore";
    name.onclick = () => centerOn(n);
    li.append(name);
    if (info[4]) {
      const sel = document.createElement("select");
      sel.title = "Escolha deste nó";
      if (!choice.has(n.id)) sel.append(new Option("Escolha um…", "", true, true));
      info[4].forEach((stats, i) => sel.append(new Option(stats.join(" / "), String(i), false, choice.get(n.id) === i)));
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
}

// ---- tooltip ------------------------------------------------------------------------------

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

function showTip(id, x, y) {
  const info = T.info[id];
  if (!info) { tip.style.display = "none"; return; }
  const [name, stats, rem, flav, variants] = info;
  let html = `<b>${esc(name)}</b>` + stats.map((s) => `<div class="s">${esc(s)}</div>`).join("");
  if (variants) {
    html += '<div class="v">Escolha uma opção:' +
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

let drag = null;
canvas.addEventListener("pointerdown", (e) => {
  drag = { x0: e.clientX, y0: e.clientY, moved: false, view: { ...view } };
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener("pointermove", (e) => {
  if (drag) {
    if (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 5) return;
    drag.moved = true;
    canvas.classList.add("drag");
    tip.style.display = "none";
    const s = view.w / box().width;
    setView({ ...drag.view, x: drag.view.x - (e.clientX - drag.x0) * s, y: drag.view.y - (e.clientY - drag.y0) * s });
    return;
  }
  const id = nodeAt(e.clientX, e.clientY);
  canvas.classList.toggle("over", id != null);
  if (id !== hover) { hover = id; preview = previewFor(id); draw(); }
  if (id != null) showTip(id, e.clientX, e.clientY);
  else tip.style.display = "none";
});
canvas.addEventListener("pointerup", (e) => {
  const wasClick = drag && !drag.moved;
  drag = null;
  canvas.classList.remove("drag");
  if (!wasClick) return;
  const id = nodeAt(e.clientX, e.clientY);
  if (id != null) {
    click(id);
    if (e.pointerType === "mouse") showTip(id, e.clientX, e.clientY);
  }
});
canvas.addEventListener("pointerleave", () => {
  tip.style.display = "none";
  if (hover != null) { hover = null; preview = null; draw(); }
});
canvas.addEventListener("wheel", (e) => { e.preventDefault(); zoomAt(Math.pow(1.0015, -e.deltaY), e.clientX, e.clientY); }, { passive: false });

$("in").onclick = () => zoomAt(1.3, ...center());
$("out").onclick = () => zoomAt(1 / 1.3, ...center());
$("fit").onclick = fit;
$("clear").onclick = () => { picked.clear(); choice.clear(); changed(); };
$("panelBtn").onclick = () => { $("panel").classList.toggle("hidden"); $("panelBtn").classList.toggle("on"); };
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
      const text = (info[0] + " " + info[1].join(" ") + " " + (info[4] ?? []).flat().join(" ") + " " + info[5]).toLowerCase();
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
  if (e.key === "+" || e.key === "=") zoomAt(1.3, ...center());
  if (e.key === "-") zoomAt(1 / 1.3, ...center());
  if (e.key === "0") fit();
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
