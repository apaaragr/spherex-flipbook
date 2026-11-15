// Landing page: hero blink, target gallery, all-sky map. Reads the same data/ files as the viewer.
"use strict";
const $ = (id) => document.getElementById(id);
const getJSON = (u) => fetch(u).then((r) => { if (!r.ok) throw new Error(u); return r.json(); });
const loadImg = (u) => new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ok(null); i.src = u; });

function checkBand(m) {
  if (m.kind !== "moving") return "ALL";
  const b = m.check && m.check.bands && m.check.bands[0];
  return b && b !== "ALL" ? b : "ALL";
}
function result(m) {
  const c = m.check, v = m.variability;
  if (m.kind === "moving" && c && c.measured_total_arcsec != null) {
    const ok = c.error_arcsec < m.grid.pixel_arcsec && (c.signal_to_noise || 0) >= 3 && /^(?!.*tentative)/i.test(m.look_for || "");
    return { cls: ok ? "good" : "warn", text: `${ok ? "Moved" : "Tentative:"} ${c.measured_total_arcsec.toFixed(1)}″ in ${c.years} yr (catalogue ${c.predicted_total_arcsec.toFixed(1)}″)` };
  }
  const sat = Math.max(0, ...m.passes.filter((p) => p.full).map((p) => p.saturated_fraction_at_target || 0));
  if (v && sat > 0.5) return { cls: "warn", text: `Too bright to measure: saturated in ${Math.round(sat * 100)}% of images` };
  if (v) {
    const pct = Math.abs(v.median_change - 1) * 100, real = pct > 3 * Math.max(v.median_field_scatter * 100, 1);
    return { cls: real ? "good" : "warn", text: `${real ? "" : "Not clearly: "}${v.median_change >= 1 ? "brightened" : "faded"} ${pct.toFixed(0)}% (steady stars ±${(v.median_field_scatter * 100).toFixed(1)}%)` };
  }
  return { cls: "warn", text: "Needs two full passes" };
}

// draw a centred crop of a frame, pixel-sharp, with an optional crosshair at a grid pixel
function drawCrop(ctx, img, n, crop, cross, W) {
  const c = (n - 1) / 2, x0 = Math.round(c - crop), s = W / (2 * crop + 1);
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = "#020208"; ctx.fillRect(0, 0, W, W);
  if (img) ctx.drawImage(img, x0, x0, 2 * crop + 1, 2 * crop + 1, 0, 0, W, W);
  if (cross) {
    const cx = (cross[0] - x0 + 0.5) * s, cy = (n - 1 - cross[1] - x0 + 0.5) * s, g = s * 1.4, L = s * 3;
    ctx.strokeStyle = "#ff5d73"; ctx.lineWidth = 2.5; ctx.beginPath();
    ctx.moveTo(cx - L, cy); ctx.lineTo(cx - g, cy); ctx.moveTo(cx + g, cy); ctx.lineTo(cx + L, cy);
    ctx.moveTo(cx, cy - L); ctx.lineTo(cx, cy - g); ctx.moveTo(cx, cy + g); ctx.lineTo(cx, cy + L); ctx.stroke();
  }
}
async function animate(canvas, key, m, band, crop, label) {
  const full = m.passes.filter((p) => p.full && p.frames[band]);
  const ps = full.length > 2 && canvas.id === "heroCanvas" ? [full[0], full[full.length - 1]] : full;
  const imgs = await Promise.all(ps.map((p) => loadImg(`data/${key}/${p.frames[band]}`)));
  const ctx = canvas.getContext("2d"); let i = 0;
  const tick = () => {
    const p = ps[i % ps.length];
    drawCrop(ctx, imgs[i % ps.length], m.grid.n, crop, m.kind === "moving" ? p.predicted_px : null, canvas.width);
    if (label) label.textContent = p.date.slice(0, 7);
    i++;
  };
  tick(); setInterval(tick, canvas.id === "heroCanvas" ? 900 : 1100);
}

// ---------- all-sky map (Mollweide, RA increasing to the left as on the sky) ----------
const R = 134.35, CX = 400, CY = 210, D = Math.PI / 180;
function moll(ra, dec) {
  let lam = -(((ra + 180) % 360 + 360) % 360 - 180) * D, phi = dec * D, th = phi;
  for (let k = 0; k < 20; k++) { const f = 2 * th + Math.sin(2 * th) - Math.PI * Math.sin(phi); th -= f / (2 + 2 * Math.cos(2 * th) || 1e-9); }
  return [CX + (2 * Math.SQRT2 / Math.PI) * R * lam * Math.cos(th), CY - Math.SQRT2 * R * Math.sin(th)];
}
function galToEq(l) { // galactic plane (b = 0) -> RA/Dec, J2000
  const dgp = 27.12825 * D, agp = 192.85948, lncp = 122.93192 * D, x = lncp - l * D;
  const dec = Math.asin(Math.cos(dgp) * Math.cos(x));
  const ra = agp + Math.atan2(Math.sin(x), -Math.sin(dgp) * Math.cos(x)) / D;
  return [((ra % 360) + 360) % 360, dec / D];
}
function path(points) { // split where the line wraps across the map edge
  let d = "", prev = null;
  for (const p of points) { d += (prev && Math.abs(p[0] - prev[0]) < 200 ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1); prev = p; }
  return d;
}
function drawSky(index) {
  const svg = $("skymap"); let h = `<defs><linearGradient id="mwGrad" x1="0" x2="1"><stop offset="0" stop-color="#8b5cf6"/><stop offset=".5" stop-color="#22d3ee"/><stop offset="1" stop-color="#3b82f6"/></linearGradient></defs>`;
  h += `<ellipse class="edge" cx="${CX}" cy="${CY}" rx="${2 * Math.SQRT2 * R}" ry="${Math.SQRT2 * R}"/>`;
  for (let ra = 0; ra < 360; ra += 30) h += `<path class="grat" d="${path(Array.from({ length: 61 }, (_, k) => moll(ra === 180 ? 179.999 : ra, -90 + 3 * k)))}"/>`;
  for (let dec = -60; dec <= 60; dec += 30) h += `<path class="grat" d="${path(Array.from({ length: 121 }, (_, k) => moll(180.001 + 3 * k * 0.9999, dec)))}"/>`;
  const mw = Array.from({ length: 361 }, (_, k) => moll(...galToEq(k)));
  h += `<path class="mw" d="${path(mw)}"/>`;
  [[0, "0h"], [90, "6h"], [270, "18h"]].forEach(([ra, t]) => { const [x, y] = moll(ra, -30); h += `<text class="lbl" x="${x + 4}" y="${y + 14}">${t}</text>`; });
  for (const [k, t] of Object.entries(index)) {
    const [x, y] = moll(t.ra, t.dec), right = x < CX + 250;
    h += `<a href="viewer.html?target=${k}"><g class="pin ${t.kind}"><circle class="halo" cx="${x}" cy="${y}" r="11"/><circle class="dot" cx="${x}" cy="${y}" r="4.5"/>
      <text x="${right ? x + 14 : x - 14}" y="${y + 4}" text-anchor="${right ? "start" : "end"}">${t.label}</text></g></a>`;
  }
  svg.innerHTML = h;
}

async function init() {
  const index = await getJSON("data/index.json").catch(() => ({}));
  drawSky(index);
  const order = ["barnard", "epsindb", "wise0855", "rwaur", "rdra"].filter((k) => index[k]).concat(Object.keys(index).filter((k) => !["barnard", "epsindb", "wise0855", "rwaur", "rdra"].includes(k)));
  const ms = {};
  await Promise.all(order.map(async (k) => (ms[k] = await getJSON(`data/${k}/manifest.json`).catch(() => null))));
  if (ms.barnard) animate($("heroCanvas"), "barnard", ms.barnard, "ALL", 9, $("heroDate"));
  const gal = $("gallery");
  for (const k of order) {
    const m = ms[k]; if (!m) continue;
    const band = checkBand(m), r = result(m);
    const a = document.createElement("a");
    a.className = "tcard"; a.href = `viewer.html?target=${k}&band=${band}&mode=${m.kind === "moving" ? "blink" : "flip"}`;
    a.innerHTML = `<canvas width="240" height="240"></canvas><span class="badge ${m.kind}">${m.kind === "moving" ? "Mover" : "Variable"}</span>
      <h4>${m.label}</h4><p>${(m.blurb || "").split(". ")[0].replace(/\.$/, "")}.</p><p class="res ${r.cls}">${r.text}</p>`;
    gal.appendChild(a);
    animate(a.querySelector("canvas"), k, m, band, k === "wise0855" ? 8 : 10, null);
  }
}
init();
