// SPHEREx Flipbook viewer. Static: reads data/index.json + data/<target>/manifest.json produced by pipeline/build.py.
"use strict";

const DETECTORS = {
  ALL: "All detectors (combined)",
  D1: "D1 · 0.75–1.09 µm", D2: "D2 · 1.10–1.62 µm", D3: "D3 · 1.63–2.41 µm",
  D4: "D4 · 2.42–3.82 µm", D5: "D5 · 3.83–4.41 µm", D6: "D6 · 4.42–5.00 µm",
};
const MODE_HINTS = {
  flip: "Plays every pass in order. Moving objects hop; variable stars pulse.",
  blink: "Alternates the first and last pass: the biggest change, back and forth.",
  diff: "Each pass minus the first full pass. Red = brighter/new, blue = fainter/gone. A mover shows as a red–blue pair.",
};
const $ = (id) => document.getElementById(id);
const S = { index: {}, key: null, m: null, spec: [], band: "ALL", mode: "flip", frame: 0, playing: true,
  speed: 700, zoom: 9, invert: true, overlay: true, fullOnly: true, timer: null, imgs: {} };

// ---------- URL state ----------
function readURL() {
  const q = new URLSearchParams(location.search);
  if (q.get("band")) S.band = q.get("band");
  if (q.get("mode")) S.mode = q.get("mode");
  if (q.get("zoom")) S.zoom = +q.get("zoom");
  if (q.get("speed")) S.speed = +q.get("speed");
  if (q.has("invert")) S.invert = q.get("invert") !== "0";
  if (q.has("overlay")) S.overlay = q.get("overlay") !== "0";
  if (q.has("full")) S.fullOnly = q.get("full") !== "0";
  return q;
}
function writeURL() {
  const q = new URLSearchParams({ target: S.key || "", band: S.band, mode: S.mode, zoom: S.zoom, speed: S.speed,
    invert: +S.invert, overlay: +S.overlay, full: +S.fullOnly });
  history.replaceState(null, "", "?" + q.toString());
}

// ---------- coordinates ----------
function parseCoord(s) {
  s = s.trim().replace(/−/g, "-");
  if (!s) return null;
  const neg = s.slice(1).includes("-"); // RA is never negative, so any minus sign belongs to declination
  const t = s.replace(/[hHdD°mM′'sS″":,+]/g, " ").replace(/-/g, " -").trim().split(/\s+/).map(Number);
  if (t.some(isNaN)) return null;
  if (t.length === 2) return { ra: t[0], dec: t[1] };
  if (t.length === 6) {
    const ra = 15 * (t[0] + t[1] / 60 + t[2] / 3600);
    const dec = (neg || t[3] < 0 ? -1 : 1) * (Math.abs(t[3]) + t[4] / 60 + t[5] / 3600);
    return { ra, dec };
  }
  return null;
}
function angSepDeg(a, b) {
  const r = Math.PI / 180;
  const c = Math.sin(a.dec * r) * Math.sin(b.dec * r) + Math.cos(a.dec * r) * Math.cos(b.dec * r) * Math.cos((a.ra - b.ra) * r);
  return Math.acos(Math.min(1, Math.max(-1, c))) / r;
}
function fmtRA(deg) {
  let h = ((deg % 360) + 360) % 360 / 15; const hh = Math.floor(h); const mm = Math.floor((h - hh) * 60);
  const ss = ((h - hh) * 60 - mm) * 60; return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:${ss.toFixed(2).padStart(5, "0")}`;
}
function fmtDec(deg) {
  const sg = deg < 0 ? "−" : "+"; const a = Math.abs(deg); const d = Math.floor(a); const m = Math.floor((a - d) * 60);
  const s = ((a - d) * 60 - m) * 60; return `${sg}${String(d).padStart(2, "0")}:${String(m).padStart(2, "0")}:${s.toFixed(1).padStart(4, "0")}`;
}
// pixel on the north-up TAN grid (0-based, y up) -> sky
function pixToSky(x, y) {
  const g = S.m.grid, r = Math.PI / 180, c = (g.n - 1) / 2;
  const xi = (-(x - c) * g.pixel_arcsec / 3600) * r, eta = ((y - c) * g.pixel_arcsec / 3600) * r;
  const d0 = g.dec * r, den = Math.cos(d0) - eta * Math.sin(d0);
  const ra = g.ra + Math.atan2(xi, den) / r;
  const dec = Math.atan2(Math.sin(d0) + eta * Math.cos(d0), Math.hypot(xi, den)) / r;
  return { ra: (ra + 360) % 360, dec };
}

// ---------- data ----------
async function getJSON(url) { const r = await fetch(url); if (!r.ok) throw new Error(url + " " + r.status); return r.json(); }
function img(url) {
  if (!S.imgs[url]) { const i = new Image(); i.src = url; S.imgs[url] = new Promise((ok) => { i.onload = () => ok(i); i.onerror = () => ok(null); }); }
  return S.imgs[url];
}
async function loadTarget(key) {
  S.key = key; S.frame = 0;
  const base = `data/${key}/`;
  S.m = await getJSON(base + "manifest.json");
  S.spec = await getJSON(base + "spectrum.json").catch(() => []);
  const bands = ["ALL", ...new Set(S.m.passes.flatMap((p) => Object.keys(p.frames)).filter((b) => b !== "ALL"))].sort((a, b) => (a === "ALL" ? -1 : b === "ALL" ? 1 : a.localeCompare(b)));
  $("band").innerHTML = bands.map((b) => `<option value="${b}">${DETECTORS[b] || b}</option>`).join("");
  if (!bands.includes(S.band)) S.band = "ALL";
  $("band").value = S.band;
  $("target").value = key;
  // preload every frame for smooth blinking
  S.m.passes.forEach((p) => [...Object.values(p.frames), ...Object.values(p.diff_frames || {})].forEach((f) => img(base + f)));
  renderPanels(); restart(); writeURL();
}
function shownPasses() {
  const ps = S.m.passes.filter((p) => (!S.fullOnly || p.full) && p.frames[S.band]);
  if (S.mode === "blink" && ps.length > 2) return [ps[0], ps[ps.length - 1]];
  return ps;
}

// ---------- drawing ----------
async function draw() {
  if (!S.m) return;
  const ps = shownPasses();
  if (!ps.length) { $("caption").textContent = "No passes with this detector — try “All detectors” or untick “Full-sky passes only”."; return; }
  S.frame %= ps.length;
  const p = ps[S.frame];
  const file = S.mode === "diff" ? (p.diff_frames || {})[S.band] : p.frames[S.band];
  const im = file ? await img(`data/${S.key}/${file}`) : null;
  const n = S.m.grid.n, z = S.zoom, cv = $("sky"), ctx = cv.getContext("2d");
  if (cv.width !== n * z) { cv.width = cv.height = n * z; }
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.filter = S.invert && S.mode !== "diff" ? "invert(1)" : "none";
  ctx.clearRect(0, 0, cv.width, cv.height);
  if (im) ctx.drawImage(im, 0, 0, n * z, n * z);
  ctx.restore();
  if (S.overlay && S.m.kind === "moving") drawOverlay(ctx, ps, p, n, z);
  $("olegend").querySelectorAll("span")[0].style.display = $("olegend").querySelectorAll("span")[1].style.display = S.overlay && S.m.kind === "moving" ? "" : "none";
  // loop-reset cue (dashed border, as in WiseView) so a hop back isn't mistaken for motion
  cv.classList.toggle("reset", S.frame === 0 && ps.length > 1 && S.playing);
  $("scalebar").querySelector("span").style.width = (60 / S.m.grid.pixel_arcsec) * z + "px";
  // legend + caption
  $("legend").innerHTML = ps.map((q, i) => `<button type="button" class="${i === S.frame ? "cur" : ""} ${S.mode === "diff" && q.date === (S.m.passes.find((x) => x.full) || {}).date ? "base" : ""}" data-i="${i}" title="${q.start} → ${q.end}">${q.date.slice(0, 7)}</button>`).join("");
  const dets = p.detectors.join(", ");
  const prev = S.frame > 0 ? ps[S.frame - 1] : null;
  const gap = prev ? ` · <span class="gap">+${Math.round((p.mjd - prev.mjd) / 30.44)} months</span>` : "";
  $("caption").innerHTML = `<b>Pass ${S.frame + 1}/${ps.length}</b>${gap} · ${p.start} → ${p.end} · ${p.n_images} images · detectors ${dets}${S.mode === "diff" ? ` · minus ${S.m.diff_base}` : ""}`;
  renderAboutPass(p);
}
function toCanvas(px, n, z) { return [(px[0] + 0.5) * z, (n - 1 - px[1] + 0.5) * z]; }
function drawOverlay(ctx, ps, cur, n, z) {
  const css = getComputedStyle(document.documentElement);
  const red = css.getPropertyValue("--pred").trim() || "#e5484d";
  ctx.save();
  ctx.strokeStyle = red; ctx.fillStyle = red; ctx.lineWidth = 1.5;
  const pts = S.m.passes.filter((p) => p.full || !S.fullOnly).map((p) => toCanvas(p.predicted_px, n, z));
  ctx.globalAlpha = 0.55; ctx.setLineDash([4, 4]); ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke(); ctx.setLineDash([]);
  pts.forEach(([x, y]) => { ctx.beginPath(); ctx.arc(x, y, 2, 0, 7); ctx.fill(); });
  // current predicted position: open crosshair so the star itself stays visible
  const [x, y] = toCanvas(cur.predicted_px, n, z), g = z * 1.6, L = z * 3.2;
  ctx.globalAlpha = 1; ctx.lineWidth = 2; ctx.beginPath();
  ctx.moveTo(x - L, y); ctx.lineTo(x - g, y); ctx.moveTo(x + g, y); ctx.lineTo(x + L, y);
  ctx.moveTo(x, y - L); ctx.lineTo(x, y - g); ctx.moveTo(x, y + g); ctx.lineTo(x, y + L); ctx.stroke();
  ctx.restore();
}

// ---------- playback ----------
function restart() {
  clearInterval(S.timer);
  draw();
  if (S.playing) S.timer = setInterval(() => { S.frame++; draw(); }, S.speed);
  $("play").textContent = S.playing ? "❚❚" : "▶︎";
  $("play").setAttribute("aria-label", S.playing ? "Pause" : "Play");
}

// ---------- side panels ----------
function dirWords(e, n) {
  const a = (Math.atan2(e, n) * 180 / Math.PI + 360) % 360;
  return ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"][Math.round(a / 45) % 8];
}
function renderPanels() {
  const m = S.m, c = m.check, el = $("check");
  $("objName").textContent = m.label;
  $("objBlurb").textContent = m.blurb || "";
  $("guide").innerHTML = `<b>What to look for:</b> ${m.look_for || "anything that hops or changes brightness between passes."}`;
  $("checkTitle").textContent = m.kind === "moving" ? "Does it really move?" : "Does it really change?";
  $("tabCheck").textContent = m.kind === "moving" ? "Motion" : "Brightness";
  if (m.kind === "field") {
    el.innerHTML = `<p class="note">A custom field: no catalogue target here. Blink or Difference mode shows anything that moved or changed between passes.</p>`;
  } else if (m.kind !== "moving") {
    const v = m.variability;
    const sat = Math.max(0, ...m.passes.filter((p) => p.full).map((p) => p.saturated_fraction_at_target || 0));
    if (v && sat > 0.5) {
      el.innerHTML = `<p class="verdict warn">Too bright to measure: saturated in ${Math.round(sat * 100)}% of images</p>
      <p class="note" style="margin-top:0">${m.label} is so bright in the infrared that its core overflows SPHEREx's detectors in most images, so brightness ratios between passes are not reliable (our non-variable control, Barnard's Star, shows similar false jumps for the same reason). Blink mode still shows the star, but the change can't be quantified from this data.</p>`;
    } else if (!v) {
      el.innerHTML = `<p class="note">${m.label} is a <b>variable star</b>: it changes brightness, not position. Needs two full passes to measure the change.</p>`;
    } else {
      const ch = v.median_change, pct = Math.abs(ch - 1) * 100, noise = v.median_field_scatter * 100;
      const real = pct > 3 * Math.max(noise, 1);
      const rows = Object.entries(v.per_detector).map(([d, r]) => `<span>${d}</span><span>×${(r.target_ratio / r.field_ratio_median).toFixed(2)} <small style="color:var(--muted)">(stars ±${(r.field_ratio_scatter * 100).toFixed(0)}%)</small></span>`).join("");
      el.innerHTML = `
      <p class="verdict ${real ? "good" : "warn"}">${real ? "Yes" : "Not clearly"}: it ${ch >= 1 ? "brightened" : "faded"} ${ch >= 1 ? "×" + ch.toFixed(2) : "to ×" + ch.toFixed(2)} (${pct.toFixed(0)}%)</p>
      <div class="kv"><span>Between</span><span>${v.from} → ${v.to}</span>${rows}
        <span>Steady stars changed</span><span>±${noise.toFixed(1)}% (typical)</span></div>
      <p class="note">Brightness ratio of the star, last pass ÷ first pass, per detector, divided by the same ratio for nearby steady stars.</p>`;
    }
  } else if (!c || c.measured_total_arcsec == null) {
    el.innerHTML = `<p class="empty">Needs at least two full passes to measure motion.</p>`;
  } else {
    const ok = c.error_arcsec < m.grid.pixel_arcsec && (c.signal_to_noise || 0) >= 3;
    el.innerHTML = `
      <p class="verdict ${ok ? "good" : "warn"}">${ok ? "Yes" : "Not clearly"}: it moved ${c.measured_total_arcsec.toFixed(1)}″ ${dirWords(...c.measured_arcsec)} in ${c.years} yr</p>
      <div class="kv">
        <span>Measured shift</span><span>${c.measured_total_arcsec.toFixed(2)}″ (${(c.measured_total_arcsec / m.grid.pixel_arcsec).toFixed(2)} px)</span>
        <span>Catalogue prediction</span><span>${c.predicted_total_arcsec.toFixed(2)}″</span>
        <span>Difference</span><span>${c.error_arcsec.toFixed(2)}″</span>
        <span>Still stars moved (noise)</span><span>${c.field_star_shift_arcsec_median != null ? c.field_star_shift_arcsec_median.toFixed(2) + "″ · " + c.n_field_stars + " stars" : "–"}</span>
        <span>Signal ÷ noise</span><span>${c.signal_to_noise != null ? c.signal_to_noise.toFixed(0) + "×" : "–"}</span>
        <span>Baseline</span><span>${c.from} → ${c.to}</span>
      </div>
      <p class="note">Prediction from ${m.reference}. Nearby stars that shouldn't move set the noise floor.</p>`;
  }
  const vd = el.querySelector(".verdict");
  $("objResult").innerHTML = vd ? `<p class="verdict ${vd.className.includes("good") ? "good" : "warn"}">${vd.textContent}</p><button type="button" class="linkbtn" data-goto="checkCard">See the evidence →</button>` : "";
  renderSpectrum();
  const g = m.grid;
  $("about").innerHTML = `
    <dt>Target</dt><dd>${m.label}</dd>
    <dt>Centre</dt><dd>${fmtRA(g.ra)} ${fmtDec(g.dec)}</dd>
    <dt>Field</dt><dd>${(g.fov_deg * 60).toFixed(1)}′ · ${g.n}×${g.n} px of ${g.pixel_arcsec}″</dd>
    <dt>Images</dt><dd>${m.n_images_used} used of ${m.n_images_total}${m.n_failed ? ` (${m.n_failed} downloads failed)` : ""}</dd>
    <dt>SPHEREx data</dt><dd>pipeline v${m.spherex_versions.join(", ")}</dd>
    <dt>Built</dt><dd>${m.built}</dd>
    <dt id="satLabel">This pass</dt><dd id="satVal">–</dd>`;
  const ra = g.ra.toFixed(5), dec = g.dec.toFixed(5);
  $("links").innerHTML = `
    <a target="_blank" rel="noopener" href="https://irsa.ipac.caltech.edu/Missions/spherex.html">IRSA SPHEREx archive</a>
    <a target="_blank" rel="noopener" href="https://www.legacysurvey.org/viewer?ra=${ra}&dec=${dec}&layer=unwise-neo7&zoom=13">unWISE (Legacy Survey)</a>
    <a target="_blank" rel="noopener" href="http://byw.tools/wiseview#ra=${ra}&dec=${dec}&size=${Math.round(g.fov_deg * 3600)}">WiseView</a>
    <a target="_blank" rel="noopener" href="https://simbad.cds.unistra.fr/simbad/sim-coo?Coord=${ra}+${dec}&Radius=2&Radius.unit=arcmin">SIMBAD</a>`;
}
function renderAboutPass(p) {
  const v = $("satVal"); if (!v) return;
  v.textContent = p.saturated_fraction_at_target > 0.2 ? `target core saturated in ${Math.round(p.saturated_fraction_at_target * 100)}% of images (shown filled)` : "target core unsaturated";
}
function renderSpectrum() {
  const box = $("spectrum"), all = $("specFlagged").checked;
  const pts = S.spec.filter((s) => all || (!s.saturated && s.n_nan_in_aperture === 0)).filter((s) => s.flux > 0);
  const passes = [...new Set(pts.map((s) => s.pass))].sort((a, b) => a - b);
  if (!pts.length) { box.innerHTML = S.spec.length
      ? `<p class="empty">${S.m.label} is so bright in the infrared that its core saturates SPHEREx's detectors in every image, so there are no clean brightness readings. Tick the box to see the flagged points anyway: they show the shape, not the true brightness.</p>`
      : `<p class="empty">No brightness readings at the target.</p>`;
    return; }
  const W = 300, H = 190, L = 34, B = 24, T = 8, R = 8;
  const x = (w) => L + (w - 0.7) / (5.1 - 0.7) * (W - L - R);
  const ly = pts.map((s) => Math.log10(s.flux)), y0 = Math.min(...ly), y1 = Math.max(...ly) + 1e-6;
  const y = (f) => T + (1 - (Math.log10(f) - y0) / (y1 - y0)) * (H - T - B);
  const cols = ["--s1", "--s2", "--s3", "--s4", "--s5", "--s6"].map((v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim());
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Brightness versus wavelength at the target, one colour per pass">`;
  svg += `<line class="axis" x1="${L}" y1="${H - B}" x2="${W - R}" y2="${H - B}"/><line class="axis" x1="${L}" y1="${T}" x2="${L}" y2="${H - B}"/>`;
  [1, 2, 3, 4, 5].forEach((w) => (svg += `<text x="${x(w)}" y="${H - 8}" text-anchor="middle">${w}</text>`));
  svg += `<text x="${W - R}" y="${H - B - 4}" text-anchor="end">µm</text><text x="4" y="${T + 8}">bright</text><text x="4" y="${H - B}">faint</text>`;
  pts.forEach((s) => { const c = cols[passes.indexOf(s.pass) % cols.length]; svg += `<circle cx="${x(s.wavelength_um).toFixed(1)}" cy="${y(s.flux).toFixed(1)}" r="2.2" fill="${c}" fill-opacity="0.85"><title>${s.wavelength_um.toFixed(3)} µm · pass ${s.pass + 1}${s.saturated ? " · saturated" : ""}</title></circle>`; });
  svg += "</svg>";
  const leg = passes.map((p, i) => { const q = S.m.passes.find((z) => z.index === p); return `<span style="color:${cols[i % cols.length]}">● ${q ? q.date.slice(0, 7) : "pass " + (p + 1)}</span>`; }).join(" ");
  box.innerHTML = svg + `<p class="note">${leg}<br>Each dot is one SPHEREx image: its filter colour depends on where the star lands on the detector. Log brightness, relative units.</p>`;
}

// ---------- events ----------
function showTab(id) {
  document.querySelectorAll(".tabpane").forEach((p) => (p.hidden = p.id !== id));
  document.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === id));
}
function bind() {
  document.querySelectorAll(".tabs button").forEach((b) => (b.onclick = () => showTab(b.dataset.tab)));
  document.querySelector(".findings").addEventListener("click", (e) => { const g = e.target.dataset && e.target.dataset.goto; if (g) showTab(g); });
  $("target").onchange = (e) => loadTarget(e.target.value);
  $("band").onchange = (e) => { S.band = e.target.value; S.frame = 0; restart(); writeURL(); };
  document.querySelectorAll(".seg button").forEach((b) => (b.onclick = () => setMode(b.dataset.mode)));
  $("speed").oninput = (e) => { S.speed = +e.target.value; $("speedOut").textContent = S.speed + " ms"; restart(); writeURL(); };
  $("zoom").oninput = (e) => { S.zoom = +e.target.value; $("zoomOut").textContent = S.zoom + "×"; draw(); writeURL(); };
  $("invert").onchange = (e) => { S.invert = e.target.checked; draw(); writeURL(); };
  $("overlay").onchange = (e) => { S.overlay = e.target.checked; draw(); writeURL(); };
  $("fullOnly").onchange = (e) => { S.fullOnly = e.target.checked; S.frame = 0; draw(); writeURL(); };
  $("specFlagged").onchange = renderSpectrum;
  $("play").onclick = () => { S.playing = !S.playing; restart(); };
  $("prev").onclick = () => { S.playing = false; S.frame = (S.frame - 1 + shownPasses().length) % shownPasses().length; restart(); };
  $("next").onclick = () => { S.playing = false; S.frame++; restart(); };
  $("legend").onclick = (e) => { const i = e.target.dataset.i; if (i != null) { S.playing = false; S.frame = +i; restart(); } };
  $("go").onclick = goCoord;
  $("coord").onkeydown = (e) => { if (e.key === "Enter") goCoord(); };
  $("sky").onclick = (e) => {
    if (!S.m) return;
    const r = e.currentTarget.getBoundingClientRect(), n = S.m.grid.n;
    const px = Math.floor((e.clientX - r.left) / r.width * n), py = n - 1 - Math.floor((e.clientY - r.top) / r.height * n);
    const s = pixToSky(px, py);
    $("clickinfo").innerHTML = `Clicked: <b>${fmtRA(s.ra)} ${fmtDec(s.dec)}</b> (${s.ra.toFixed(5)}°, ${s.dec.toFixed(5)}°)`;
  };
  document.addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
    if (e.key === " ") { e.preventDefault(); $("play").click(); }
    if (e.key === "ArrowRight") $("next").click();
    if (e.key === "ArrowLeft") $("prev").click();
  });
}
function setMode(m) {
  S.mode = m; S.frame = 0;
  document.querySelectorAll(".seg button").forEach((b) => b.classList.toggle("on", b.dataset.mode === m));
  $("modeHint").textContent = MODE_HINTS[m]; restart(); writeURL();
}
function goCoord() {
  const c = parseCoord($("coord").value), msg = $("coordMsg");
  if (!c || c.dec < -90 || c.dec > 90) { msg.textContent = "Couldn't read that. Try “269.446 4.768” or “17:57:48.5 +04:41:36”."; msg.className = "hint err"; return; }
  let best = null;
  for (const [k, t] of Object.entries(S.index)) { const d = angSepDeg(c, t); if (!best || d < best.d) best = { k, d }; }
  const fov = S.m ? S.m.grid.fov_deg : 0.1;
  if (best && best.d < fov / 2) { msg.textContent = `Inside the ${S.index[best.k].label} field.`; msg.className = "hint"; loadTarget(best.k); return; }
  const ra = c.ra.toFixed(5), dec = c.dec.toFixed(5);
  msg.innerHTML = `${fmtRA(c.ra)} ${fmtDec(c.dec)} isn't in the showcase yet. Look at it now in
    <a target="_blank" rel="noopener" href="https://www.legacysurvey.org/viewer?ra=${ra}&dec=${dec}&layer=unwise-neo7&zoom=13">unWISE</a>
    <a target="_blank" rel="noopener" href="http://byw.tools/wiseview#ra=${ra}&dec=${dec}&size=360">WiseView</a>
    <a target="_blank" rel="noopener" href="https://simbad.cds.unistra.fr/simbad/sim-coo?Coord=${ra}+${dec}&Radius=2&Radius.unit=arcmin">SIMBAD</a>
    or <a target="_blank" rel="noopener" href="https://github.com/apaaragr/spherex-flipbook#run-it">build it yourself</a>.`;
  msg.className = "hint err";
}

async function init() {
  const q = readURL();
  $("speed").value = S.speed; $("speedOut").textContent = S.speed + " ms";
  $("zoom").value = S.zoom; $("zoomOut").textContent = S.zoom + "×";
  $("invert").checked = S.invert; $("overlay").checked = S.overlay; $("fullOnly").checked = S.fullOnly;
  bind();
  S.index = await getJSON("data/index.json").catch(() => ({}));
  const keys = Object.keys(S.index);
  $("target").innerHTML = keys.map((k) => `<option value="${k}">${S.index[k].label}</option>`).join("") || `<option>No targets built yet</option>`;
  setMode(S.mode in MODE_HINTS ? S.mode : "flip");
  let key = q.get("target");
  if (q.get("ra") && q.get("dec")) { $("coord").value = `${q.get("ra")} ${q.get("dec")}`; }
  if (!keys.includes(key)) key = keys[0];
  if (key) await loadTarget(key);
  if (q.get("ra") && q.get("dec")) goCoord();
}
init();
