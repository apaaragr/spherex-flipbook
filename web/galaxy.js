// Scroll-driven galaxy story. Scene unit = 1,000 light-years; galactic centre at the origin, Sun at (-26, 0, 0).
// Galactic Cartesian (X towards the centre, Y towards rotation, Z north) maps to scene (x, y, z) = (X, Z, -Y).
// Scrolling moves the camera through three keyframes: whole galaxy -> the Sun's corner -> the neighbourhood.
"use strict";
(async function () {
  const host = document.getElementById("scene");
  const fail = (msg) => { host.innerHTML = `<p style="padding:110px 24px;color:#8b8da3">${msg}</p>`; };
  if (typeof THREE === "undefined") return fail("The 3D view could not load. <a href='viewer.html'>Go straight to the data →</a>");
  const D = Math.PI / 180, SUN = new THREE.Vector3(-26, 0, 0), LOG_S = 0.05;
  const W = () => window.innerWidth, H = () => window.innerHeight;
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ antialias: true }); } catch (e) { return fail("Your browser can't show 3D graphics. <a href='viewer.html'>Go straight to the data →</a>"); }
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setSize(W(), H());
  renderer.setClearColor(0x020208);
  host.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, W() / H(), 0.001, 2000);

  // ---------- galaxy (artist's impression) ----------
  const dot = (() => { const c = document.createElement("canvas"); c.width = c.height = 64; const g = c.getContext("2d");
    const r = g.createRadialGradient(32, 32, 0, 32, 32, 32); r.addColorStop(0, "rgba(255,255,255,1)"); r.addColorStop(0.35, "rgba(255,255,255,.55)"); r.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = r; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
  const gauss = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const pos = [], col = [], c = new THREE.Color();
  const K = Math.tan(12 * D), R0 = 3, OFF = Math.PI + 0.35 - Math.log(26 / R0) / K;
  for (let i = 0; i < 70000; i++) {                       // four logarithmic spiral arms
    const arm = i % 4, r = 3 + 47 * Math.pow(Math.random(), 0.85);
    const th = Math.log(r / R0) / K + OFF + arm * Math.PI / 2 + gauss() * 0.18, sc = 0.5 + r * 0.035;
    pos.push(r * Math.cos(th) + gauss() * sc, gauss() * 0.25, r * Math.sin(th) + gauss() * sc);
    c.setHSL(0.6 - Math.random() * 0.06, 0.55, 0.62 + Math.random() * 0.3); col.push(c.r, c.g, c.b);
  }
  for (let i = 0; i < 2500; i++) {                        // Orion Spur, the minor arm the Sun sits in
    const t = Math.random(), th = Math.PI - 0.55 + t * 0.95, r = 23 + t * 5.5;
    pos.push(r * Math.cos(th) + gauss() * 1.4, gauss() * 0.25, r * Math.sin(th) + gauss() * 1.4);
    c.setHSL(0.6, 0.45, 0.5 + Math.random() * 0.2); col.push(c.r, c.g, c.b);
  }
  for (let i = 0; i < 16000; i++) {                       // central bar + bulge
    const a = 27 * D, x = gauss() * 5.5, z = gauss() * 1.8;
    pos.push(x * Math.cos(a) - z * Math.sin(a), gauss() * 1.2, x * Math.sin(a) + z * Math.cos(a));
    c.setHSL(0.09, 0.75, 0.62 + Math.random() * 0.25); col.push(c.r, c.g, c.b);
  }
  for (let i = 0; i < 25000; i++) {                       // diffuse disc
    const r = -12 * Math.log(1 - Math.random() * 0.98), th = Math.random() * 2 * Math.PI;
    pos.push(r * Math.cos(th), gauss() * 0.35, r * Math.sin(th));
    c.setHSL(0.62, 0.3, 0.45); col.push(c.r, c.g, c.b);
  }
  const gg = new THREE.BufferGeometry();
  gg.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  gg.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  const galaxyMat = new THREE.PointsMaterial({ size: 0.55, map: dot, vertexColors: true, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending });
  scene.add(new THREE.Points(gg, galaxyMat));
  const bg = []; for (let i = 0; i < 2500; i++) { const v = new THREE.Vector3(gauss(), gauss(), gauss()).normalize().multiplyScalar(400 + Math.random() * 300); bg.push(v.x, v.y, v.z); }
  const bgg = new THREE.BufferGeometry(); bgg.setAttribute("position", new THREE.Float32BufferAttribute(bg, 3));
  scene.add(new THREE.Points(bgg, new THREE.PointsMaterial({ size: 1.4, color: 0x8b8da3, transparent: true, opacity: 0.5 })));

  // ---------- the Sun ----------
  const sun = new THREE.Mesh(new THREE.SphereGeometry(0.004, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffd36b }));
  sun.position.copy(SUN); scene.add(sun);
  const sunGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: dot, color: 0xffc94a, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  sunGlow.position.copy(SUN); scene.add(sunGlow);

  // ---------- neighbourhood (true directions, logarithmic distance) ----------
  const hood = new THREE.Group(); hood.position.copy(SUN); scene.add(hood);
  const lineMat = (color, opacity) => new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
  const overlay = [];  // HTML elements that track 3D points
  const tag = (cls, html, href) => { const a = document.createElement(href ? "a" : "span"); a.className = cls; a.innerHTML = html; if (href) a.href = href; document.body.appendChild(a); return a; };
  [[1, "10 ly"], [2, "100 ly"], [3, "1,000 ly"], [3.5, "3,000 ly"]].forEach(([lg, text]) => {
    const r = LOG_S * lg, pts = Array.from({ length: 129 }, (_, k) => new THREE.Vector3(r * Math.cos(k / 64 * Math.PI), 0, r * Math.sin(k / 64 * Math.PI)));
    hood.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), lineMat(0x8b8da3, 0.35)));
    overlay.push({ el: tag("ring", text), local: new THREE.Vector3(r * 0.71, 0, r * 0.71), when: "near", below: false });
  });
  hood.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(LOG_S * 3.6, 0, 0)]), lineMat(0xffc94a, 0.5)));
  overlay.push({ el: tag("ring", "→ towards the galactic centre"), local: new THREE.Vector3(LOG_S * 3.6, 0, 0), when: "near", below: false });
  overlay.push({ el: tag("slabel sun", "Sun · you are here"), local: new THREE.Vector3(), when: "always", below: true });

  const selKey = new URLSearchParams(location.search).get("star");
  const stars = {};
  const dist = await fetch("data/distances.json").then((r) => r.json()).catch(() => ({}));
  const list = document.getElementById("starList");
  for (const [k, s] of Object.entries(dist).sort((a, b) => a[1].distance_ly - b[1].distance_ly)) {
    const l = s.l * D, b = s.b * D, rr = LOG_S * Math.log10(Math.max(1.5, s.distance_ly));
    const p = new THREE.Vector3(Math.cos(b) * Math.cos(l), Math.sin(b), -Math.cos(b) * Math.sin(l)).multiplyScalar(rr);
    const colr = s.kind === "moving" ? 0x22d3ee : 0xc4b5fd;
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.0032, 16, 12), new THREE.MeshBasicMaterial({ color: colr })); m.position.copy(p); hood.add(m);
    const g = new THREE.Sprite(new THREE.SpriteMaterial({ map: dot, color: colr, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })); g.position.copy(p); hood.add(g);
    hood.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([p, new THREE.Vector3(p.x, 0, p.z)]), lineMat(colr, 0.45)));
    const dtxt = (s.distance_ly < 100 ? s.distance_ly.toFixed(1) : Math.round(s.distance_ly / 10) * 10).toLocaleString();
    const href = `viewer.html?target=${k}&from=galaxy`;
    const el = tag(`slabel ${s.kind}${k === selKey ? " sel" : ""}`, `${s.label}<small>${dtxt} ly${s.verified ? "" : "*"}</small>`, href);
    overlay.push({ el, local: p, when: "near", below: false });
    stars[k] = { m, g, p };
    const li = document.createElement("li");
    li.innerHTML = `<a class="${s.kind}${k === selKey ? " sel" : ""}" href="${href}"><span>${s.label}</span><small>${dtxt} ly${s.verified ? "" : "*"} · ${s.kind === "moving" ? "mover" : "variable"}</small></a>`;
    list.appendChild(li);
  }

  // ---------- scroll -> camera keyframes ----------
  const KEYS = [
    { target: new THREE.Vector3(0, 0, 0), off: new THREE.Vector3(-10, 62, 58) },
    { target: SUN.clone(), off: new THREE.Vector3(-3, 17, 9) },
    { target: SUN.clone(), off: new THREE.Vector3(-0.16, 0.2, 0.3) },
  ];
  const forceP = parseFloat(new URLSearchParams(location.search).get("p"));   // test hook: freeze scroll progress (0..1)
  const progress = () => { if (forceP >= 0) return forceP; const max = document.documentElement.scrollHeight - innerHeight; return max > 0 ? Math.min(1, Math.max(0, scrollY / max)) : 0; };
  let ps = progress();
  if (selKey) { scrollTo(0, document.documentElement.scrollHeight); ps = 1; }   // returning from a star: land in the neighbourhood
  const hm = /^#ch([0-2])$/.exec(location.hash);
  if (!selKey && hm) { document.querySelectorAll(".chapter")[+hm[1]].scrollIntoView(); ps = progress(); }
  let yaw = 0, pitch = 0, drag = null;
  const cvs = renderer.domElement;
  cvs.style.touchAction = "pan-y";
  cvs.addEventListener("pointerdown", (e) => { drag = { x: e.clientX, y: e.clientY }; cvs.setPointerCapture(e.pointerId); });
  cvs.addEventListener("pointermove", (e) => {
    if (!drag) return;
    yaw -= (e.clientX - drag.x) * 0.005; if (e.pointerType === "mouse") pitch = Math.max(-0.6, Math.min(0.6, pitch + (e.clientY - drag.y) * 0.004));
    drag = { x: e.clientX, y: e.clientY };
  });
  ["pointerup", "pointercancel"].forEach((t) => cvs.addEventListener(t, () => (drag = null)));

  // chapters, dots, scroll hint
  const chapters = [...document.querySelectorAll(".chapter")], dots = [...document.querySelectorAll(".dots button")], hint = document.getElementById("scrollHint");
  dots.forEach((b) => (b.onclick = () => chapters[+b.dataset.ch].scrollIntoView({ behavior: "smooth" })));
  let lastCh = -1;
  function chapterUI(p) {
    const ch = p < 0.25 ? 0 : p < 0.75 ? 1 : 2;
    if (ch !== lastCh) { chapters.forEach((s, i) => s.classList.toggle("active", i === ch)); dots.forEach((b, i) => b.classList.toggle("on", i === ch)); lastCh = ch; }
    hint.style.opacity = p > 0.03 ? 0 : 1;
  }
  window.addEventListener("resize", () => { renderer.setSize(W(), H()); camera.aspect = W() / H(); camera.updateProjectionMatrix(); });

  const tgt = new THREE.Vector3(), off = new THREE.Vector3(), sph = new THREE.Spherical(), v3 = new THREE.Vector3();
  function cameraAt(p) {
    const seg = p < 0.5 ? 0 : 1, f0 = p < 0.5 ? p / 0.5 : (p - 0.5) / 0.5;
    const f = f0 * f0 * (3 - 2 * f0), a = KEYS[seg], b = KEYS[seg + 1];
    tgt.lerpVectors(a.target, b.target, f);
    const len = Math.exp(Math.log(a.off.length()) * (1 - f) + Math.log(b.off.length()) * f);   // even zoom across 5 orders of magnitude
    off.copy(a.off).normalize().lerp(v3.copy(b.off).normalize(), f).normalize().multiplyScalar(len);
    sph.setFromVector3(off); sph.theta += yaw; sph.phi = Math.max(0.12, Math.min(Math.PI - 0.12, sph.phi + pitch));
    camera.position.copy(tgt).add(off.setFromSpherical(sph));
    camera.lookAt(tgt);
  }
  function place(el, world, show, below) {
    v3.copy(world).project(camera);
    const vis = show && v3.z < 1 && Math.abs(v3.x) < 1.05 && Math.abs(v3.y) < 1.05;
    el.style.opacity = vis ? 1 : 0; el.style.pointerEvents = vis && el.tagName === "A" ? "auto" : "none";
    if (vis) el.style.transform = `translate(${(v3.x * 0.5 + 0.5) * W()}px, ${(-v3.y * 0.5 + 0.5) * H()}px) translate(-50%, ${below ? "45%" : "-135%"})`;
  }
  (function frame() {
    ps += (progress() - ps) * 0.09;
    if (!drag) yaw *= 0.995;                       // drift back towards the story's framing
    cameraAt(ps); chapterUI(ps);
    const dSun = camera.position.distanceTo(SUN), near = Math.max(0, Math.min(1, (3 - dSun) / 2.5));
    const camLen = camera.position.distanceTo(tgt);           // keep galaxy stars pin-sharp at every zoom
    galaxyMat.size = Math.min(0.55, Math.max(0.008, camLen * 0.013));
    galaxyMat.opacity = 0.85 - 0.6 * near;
    sunGlow.scale.setScalar(Math.max(0.0025, Math.min(0.6, dSun * 0.06)));
    sun.scale.setScalar(Math.min(1.6, Math.max(0.05, dSun / 0.4)));
    hood.visible = near > 0.02;
    for (const o of Object.values(stars)) {
      const d = camera.position.distanceTo(hood.localToWorld(v3.copy(o.p)));
      o.m.scale.setScalar(Math.min(1.6, Math.max(0.05, d / 0.4))); o.g.scale.setScalar(Math.min(0.03, Math.max(0.0015, d * 0.045)));
    }
    renderer.render(scene, camera);
    for (const o of overlay) place(o.el, hood.localToWorld(o.local.clone()), o.when === "always" || near > 0.3, o.below);
    requestAnimationFrame(frame);
  })();
})();
