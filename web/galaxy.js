// Galaxy-to-neighbourhood view. Scene unit = 1,000 light-years. Galactic centre at the origin, Sun at (-26, 0, 0).
// Galactic Cartesian (X towards the centre, Y towards rotation, Z north) maps to scene (x, y, z) = (X, Z, -Y).
"use strict";
(async function () {
  const host = document.getElementById("scene");
  if (typeof THREE === "undefined") { host.innerHTML = '<p style="padding:24px;color:#8b8da3">3D view needs WebGL and could not start in this browser.</p>'; return; }
  const D = Math.PI / 180, SUN = new THREE.Vector3(-26, 0, 0), LOG_S = 0.05; // neighbourhood: radius = LOG_S * log10(distance in ly)
  const W = () => host.clientWidth, H = () => host.clientHeight;
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ antialias: true }); } catch (e) { host.innerHTML = '<p style="padding:24px;color:#8b8da3">3D view needs WebGL.</p>'; return; }
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setSize(W(), H());
  renderer.setClearColor(0x020208);
  host.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, W() / H(), 0.001, 2000);
  const controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.minDistance = 0.08; controls.maxDistance = 220;

  // ---------- galaxy (artist's impression) ----------
  const dot = (() => { const c = document.createElement("canvas"); c.width = c.height = 64; const g = c.getContext("2d");
    const r = g.createRadialGradient(32, 32, 0, 32, 32, 32); r.addColorStop(0, "rgba(255,255,255,1)"); r.addColorStop(0.35, "rgba(255,255,255,.55)"); r.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = r; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
  const gauss = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const pos = [], col = [], c = new THREE.Color();
  const K = Math.tan(12 * D), R0 = 3, OFF = Math.PI + 0.35 - Math.log(26 / R0) / K; // one arm passes just outside the Sun
  for (let i = 0; i < 70000; i++) {                       // four logarithmic spiral arms
    const arm = i % 4, r = 3 + 47 * Math.pow(Math.random(), 0.85);
    const th = Math.log(r / R0) / K + OFF + arm * Math.PI / 2 + gauss() * 0.18;
    const sc = 0.5 + r * 0.035;
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
  const galaxy = new THREE.Points(gg, galaxyMat);
  scene.add(galaxy);
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
  const rings = [];
  [[1, "10 ly"], [2, "100 ly"], [3, "1,000 ly"], [3.5, "3,000 ly"]].forEach(([lg, text]) => {
    const r = LOG_S * lg, pts = Array.from({ length: 129 }, (_, k) => new THREE.Vector3(r * Math.cos(k / 64 * Math.PI), 0, r * Math.sin(k / 64 * Math.PI)));
    hood.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), lineMat(0x8b8da3, 0.35)));
    const el = document.createElement("span"); el.className = "ring"; el.textContent = text; host.appendChild(el);
    rings.push({ el, at: new THREE.Vector3(r * 0.71, 0, r * 0.71) });
  });
  const toCentre = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(LOG_S * 3.6, 0, 0)];
  hood.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(toCentre), lineMat(0xffc94a, 0.5)));
  const centreTag = document.createElement("span"); centreTag.className = "ring"; centreTag.textContent = "→ towards the galactic centre"; host.appendChild(centreTag);
  const labels = [];
  const mk = (cls, html, href) => { const a = document.createElement(href ? "a" : "span"); a.className = "slabel " + cls; a.innerHTML = html; if (href) a.href = href; host.appendChild(a); return a; };
  labels.push({ el: mk("sun below", "Sun · you are here"), world: () => SUN.clone(), near: true, far: true });
  const dist = await fetch("data/distances.json").then((r) => r.json()).catch(() => ({}));
  for (const [k, s] of Object.entries(dist)) {
    const l = s.l * D, b = s.b * D, rr = LOG_S * Math.log10(Math.max(1.5, s.distance_ly));
    const dir = new THREE.Vector3(Math.cos(b) * Math.cos(l), Math.sin(b), -Math.cos(b) * Math.sin(l)), p = dir.multiplyScalar(rr);
    const colr = s.kind === "moving" ? 0x22d3ee : 0xc4b5fd;
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.0032, 16, 12), new THREE.MeshBasicMaterial({ color: colr })); m.position.copy(p); hood.add(m);
    const g = new THREE.Sprite(new THREE.SpriteMaterial({ map: dot, color: colr, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })); g.position.copy(p); g.scale.setScalar(0.02); hood.add(g);
    hood.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([p, new THREE.Vector3(p.x, 0, p.z)]), lineMat(colr, 0.45)));
    const dtxt = s.distance_ly < 100 ? s.distance_ly.toFixed(1) : Math.round(s.distance_ly / 10) * 10;
    labels.push({ el: mk(s.kind, `${s.label}<small>${Number(dtxt).toLocaleString()} ly${s.verified ? "" : "*"}</small>`, `viewer.html?target=${k}`),
                  world: () => hood.localToWorld(p.clone()), near: true, far: false });
  }

  // ---------- views + fly-to ----------
  const VIEWS = {
    galaxy: { target: new THREE.Vector3(0, 0, 0), pos: new THREE.Vector3(-10, 62, 58), kicker: "The Milky Way", title: "You are here",
      text: "Our galaxy is about 100,000 light-years across. The Sun sits about 26,000 light-years from the centre, in a minor arm called the Orion Spur. All five SPHEREx Flipbook targets are so close that at this scale they would sit inside the Sun's dot.",
      fine: "The galaxy's shape is an artist's impression: no telescope can photograph the Milky Way from outside." },
    home: { target: SUN.clone(), pos: SUN.clone().add(new THREE.Vector3(-0.16, 0.2, 0.3)), kicker: "Our stellar neighbourhood", title: "Where the targets really are",
      text: "Each star sits in its true direction from the Sun. Distances run from 6 to thousands of light-years, so they are drawn on a logarithmic scale: each ring is ten times farther than the one inside it. Lines drop each star to the plane of the galaxy.",
      fine: "Distances from parallax. Barnard's Star: Gaia DR3. * = provisional value, to be verified against Gaia DR3." },
  };
  let fly = null;
  function go(name, instant) {
    const v = VIEWS[name];
    document.getElementById("hudKicker").textContent = v.kicker; document.getElementById("hudTitle").textContent = v.title;
    document.getElementById("hudText").textContent = v.text; document.getElementById("hudFine").textContent = v.fine;
    document.getElementById("btnGalaxy").classList.toggle("on", name === "galaxy"); document.getElementById("btnHome").classList.toggle("on", name === "home");
    if (instant) { camera.position.copy(v.pos); controls.target.copy(v.target); return; }
    fly = { t0: performance.now(), dur: 3200, p0: camera.position.clone(), t0v: controls.target.clone(), p1: v.pos, t1: v.target };
  }
  document.getElementById("btnGalaxy").onclick = () => go("galaxy");
  document.getElementById("btnHome").onclick = () => go("home");
  go(new URLSearchParams(location.search).get("view") === "home" ? "home" : "galaxy", true);
  window.addEventListener("resize", () => { renderer.setSize(W(), H()); camera.aspect = W() / H(); camera.updateProjectionMatrix(); });

  const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
  const v3 = new THREE.Vector3();
  function place(el, world, show) {
    v3.copy(world).project(camera);
    const vis = show && v3.z < 1 && Math.abs(v3.x) < 1.1 && Math.abs(v3.y) < 1.1;
    el.style.opacity = vis ? 1 : 0; el.style.pointerEvents = vis ? "auto" : "none";
    if (vis) el.style.transform = `translate(${(v3.x * 0.5 + 0.5) * W()}px, ${(-v3.y * 0.5 + 0.5) * H()}px) translate(-50%, ${el.classList.contains("below") ? "45%" : "-135%"})`;
  }
  (function frame(now) {
    if (fly) {
      // fly in log-space of distance so the zoom from 80,000 ly down to a few ly feels even
      const f = ease(Math.min(1, (now - fly.t0) / fly.dur));
      controls.target.lerpVectors(fly.t0v, fly.t1, f);
      const d0 = fly.p0.clone().sub(fly.t0v), d1 = fly.p1.clone().sub(fly.t1);
      const len = Math.exp(Math.log(d0.length()) * (1 - f) + Math.log(d1.length()) * f);
      camera.position.copy(controls.target).add(d0.normalize().lerp(d1.normalize(), f).normalize().multiplyScalar(len));
      if (f >= 1) fly = null;
    }
    controls.update();
    const dSun = camera.position.distanceTo(SUN);
    const nearness = Math.max(0, Math.min(1, (3 - dSun) / 2.5));   // 0 far ... 1 at the Sun
    galaxyMat.opacity = 0.85 - 0.78 * nearness;
    galaxyMat.size = 0.55 - 0.4 * nearness;
    sunGlow.scale.setScalar(Math.max(0.03, dSun * 0.035));
    hood.visible = nearness > 0.02;
    renderer.render(scene, camera);
    for (const L of labels) place(L.el, L.world(), (L.near && nearness > 0.3) || (L.far && nearness <= 0.3));
    for (const r of rings) place(r.el, hood.localToWorld(r.at.clone()), nearness > 0.3);
    place(centreTag, hood.localToWorld(toCentre[1].clone()), nearness > 0.3);
    requestAnimationFrame(frame);
  })(performance.now());
})();
