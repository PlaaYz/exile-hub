// Atlas tree planner: GGG's official atlas data (built into data.json / ruthless.json by
// scripts/atlas-build.mts, texts already in Portuguese), drawn as SVG.
// Node: [id, x, y, kind] kind 0 small, 1 notable, 2 keystone, 3 start, 4 gateway.
// Edge: [a, b] straight, [a, b, r, sweep] arc, [a, b, -1] two gateways (linked, not drawn).
// Info: id -> [name, stats, reminder, flavour, variants | null, English text for the search].
"use strict";
const SVG = "http://www.w3.org/2000/svg";
const $ = (id) => document.getElementById(id);
const map = $("map");
const gEdges = $("edges");
const gNodes = $("nodes");
const tip = $("tip");
const RADIUS = [42, 62, 88, 96, 58];

let T = null; // the loaded tree
let tree = "data";
let byId = new Map(); // id -> { id, x, y, k, el }
let adj = new Map();
let edgeEls = []; // [a, b, element]
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
  gEdges.textContent = "";
  gNodes.textContent = "";
  edgeEls = [];
  for (const [id, x, y, k] of T.nodes) byId.set(id, { id, x, y, k });
  const link = (a, b) => {
    if (!adj.has(a)) adj.set(a, new Set());
    adj.get(a).add(b);
  };
  for (const [a, b, r, sweep] of T.edges) {
    if (!byId.has(a) || !byId.has(b)) continue;
    link(a, b);
    link(b, a);
    if (r === -1) continue;
    const p = byId.get(a);
    const q = byId.get(b);
    const el = document.createElementNS(SVG, r ? "path" : "line");
    if (r) el.setAttribute("d", `M${p.x} ${p.y}A${r} ${r} 0 0 ${sweep} ${q.x} ${q.y}`);
    else {
      el.setAttribute("x1", p.x);
      el.setAttribute("y1", p.y);
      el.setAttribute("x2", q.x);
      el.setAttribute("y2", q.y);
    }
    el.setAttribute("class", "e");
    gEdges.append(el);
    edgeEls.push([a, b, el]);
  }
  for (const n of byId.values()) {
    const el = document.createElementNS(SVG, "circle");
    el.setAttribute("cx", n.x);
    el.setAttribute("cy", n.y);
    el.setAttribute("r", RADIUS[n.k]);
    el.dataset.id = n.id;
    n.el = el;
    gNodes.append(el);
  }
}

// ---- view: zoom and pan -----------------------------------------------------------------

function applyView() {
  map.setAttribute("viewBox", `${view.x} ${view.y} ${view.w} ${view.h}`);
  $("pct").textContent = Math.round(((map.getBoundingClientRect().width || innerWidth) / view.w) * 1000) / 10 + "%";
}

function fit() {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const n of byId.values()) {
    x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y); x1 = Math.max(x1, n.x); y1 = Math.max(y1, n.y);
  }
  const pad = 400;
  const w = x1 - x0 + 2 * pad, h = y1 - y0 + 2 * pad;
  // right after the page loads the SVG may not have a size yet: use the window's
  const r = map.getBoundingClientRect();
  const width = r.width || innerWidth;
  // the side panel covers the right of the map on wide screens: fit the tree in what is left
  const open = !$("panel").classList.contains("hidden");
  const side = innerWidth > 700 && open ? $("panel").offsetWidth : 0;
  // on phones the panel covers the bottom instead
  const height = r.height || innerHeight - 60;
  const below = innerWidth <= 700 && open ? $("panel").offsetHeight : 0;
  const aspect = (width - side) / Math.max(1, height - below);
  view = w / h > aspect ? { x: x0 - pad, w, h: w / aspect } : { y: y0 - pad, h, w: h * aspect };
  view.x ??= (x0 + x1) / 2 - view.w / 2;
  view.y ??= (y0 + y1) / 2 - view.h / 2;
  view.w *= width / (width - side);
  view.h *= height / (height - below);
  applyView();
}

function zoomAt(factor, cx, cy) {
  const r = map.getBoundingClientRect();
  const fx = (cx - r.left) / r.width, fy = (cy - r.top) / r.height;
  const w = Math.min(60000, Math.max(600, view.w / factor));
  const h = (view.h * w) / view.w;
  view = { x: view.x + (view.w - w) * fx, y: view.y + (view.h - h) * fy, w, h };
  applyView();
}

function centerOn(n) {
  const w = Math.min(view.w, 6000), h = (view.h * w) / view.w;
  view = { x: n.x - w / 2, y: n.y - h / 2, w, h };
  applyView();
}

const center = () => {
  const r = map.getBoundingClientRect();
  return [r.left + r.width / 2, r.top + r.height / 2];
};

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

// ---- drawing state ------------------------------------------------------------------------

function paint() {
  const soon = preview?.add ?? new Set();
  const cut = preview?.remove ?? new Set();
  const on = (id) => id === T.start || picked.has(id);
  const hitSet = new Set(hits);
  for (const n of byId.values()) {
    const cls = ["n", "k" + n.k];
    if (cut.has(n.id)) cls.push("cut");
    else if (on(n.id)) cls.push("on");
    else if (soon.has(n.id)) cls.push("soon");
    if (picked.has(n.id) && T.info[n.id]?.[4] && !choice.has(n.id)) cls.push("need");
    if (hitSet.has(n.id)) cls.push(hits[hitAt] === n.id ? "cur" : "hit");
    n.el.setAttribute("class", cls.join(" "));
  }
  for (const [a, b, el] of edgeEls) {
    const live = on(a) && on(b);
    const next = !live && (on(a) || soon.has(a)) && (on(b) || soon.has(b)) && (soon.has(a) || soon.has(b));
    el.setAttribute("class", live ? "e on" : next ? "e soon" : "e");
  }
}

function changed() {
  preview = previewFor(hover);
  paint();
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

let drag = null;
map.addEventListener("pointerdown", (e) => {
  drag = { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, moved: false, view: { ...view } };
  map.setPointerCapture(e.pointerId);
});
map.addEventListener("pointermove", (e) => {
  if (drag) {
    if (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 5) return;
    drag.moved = true;
    map.classList.add("drag");
    tip.style.display = "none";
    const s = view.w / map.getBoundingClientRect().width;
    view = { ...drag.view, x: drag.view.x - (e.clientX - drag.x0) * s, y: drag.view.y - (e.clientY - drag.y0) * s };
    applyView();
    return;
  }
  const id = e.target.dataset?.id ? Number(e.target.dataset.id) : null;
  if (id !== hover) { hover = id; preview = previewFor(id); paint(); }
  if (id != null) showTip(id, e.clientX, e.clientY);
  else tip.style.display = "none";
});
map.addEventListener("pointerup", (e) => {
  const wasClick = drag && !drag.moved;
  drag = null;
  map.classList.remove("drag");
  if (!wasClick) return;
  const id = e.target.dataset?.id ? Number(e.target.dataset.id) : null;
  if (id != null) {
    click(id);
    if (e.pointerType === "mouse") showTip(id, e.clientX, e.clientY);
  }
});
map.addEventListener("pointerleave", () => {
  tip.style.display = "none";
  if (hover != null) { hover = null; preview = null; paint(); }
});
map.addEventListener("wheel", (e) => { e.preventDefault(); zoomAt(Math.pow(1.0015, -e.deltaY), e.clientX, e.clientY); }, { passive: false });

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
  paint();
}
q.addEventListener("input", search);
q.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && hits.length) {
    hitAt = (hitAt + (e.shiftKey ? hits.length - 1 : 1)) % hits.length;
    $("hits").textContent = `${hitAt + 1} / ${hits.length}`;
    centerOn(byId.get(hits[hitAt]));
    paint();
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
  map.style.top = top + "px";
  map.style.height = innerHeight - top + "px";
  if (innerWidth > 700) $("panel").style.top = top + "px";
  if (T) applyView();
}
addEventListener("resize", layout);
layout();

// "#data:1,2.0,3" = tree and allocated nodes ("id.choice" for nodes with options)
const m = /^#(data|ruthless)(?::([\d.,]+))?/.exec(location.hash);
load(m ? m[1] : "data", m?.[2] ?? "");
if (innerWidth <= 700 && !(m && m[2])) { $("panel").classList.add("hidden"); $("panelBtn").classList.remove("on"); }
