// 3D celestial sphere with the showcase targets. Optional: if WebGL or three.js is unavailable, the section hides itself.
"use strict";
(function () {
  const section = document.getElementById("globeSection");
  const host = document.getElementById("globe");
  if (!section || !host) return;
  const hide = () => (section.style.display = "none");
  const D = Math.PI / 180;
  // RA/Dec -> point on the unit sphere (y = celestial north)
  const vec = (ra, dec, r = 1) => new THREE.Vector3(r * Math.cos(dec * D) * Math.cos(ra * D), r * Math.sin(dec * D), -r * Math.cos(dec * D) * Math.sin(ra * D));
  function galToEq(l) {
    const dgp = 27.12825 * D, agp = 192.85948, lncp = 122.93192 * D, x = lncp - l * D;
    return [agp + Math.atan2(Math.sin(x), -Math.sin(dgp) * Math.cos(x)) / D, Math.asin(Math.cos(dgp) * Math.cos(x)) / D];
  }
  function line(points, color, opacity) {
    const g = new THREE.BufferGeometry().setFromPoints(points);
    return new THREE.Line(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity }));
  }

  async function start() {
    if (typeof THREE === "undefined") return hide();
    let renderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); } catch (e) { return hide(); }
    const index = await fetch("data/index.json").then((r) => r.json()).catch(() => ({}));
    const W = () => host.clientWidth, H = () => host.clientHeight;
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(W(), H());
    host.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, W() / H(), 0.1, 100);
    camera.position.set(0, 0.3, 2.95);
    camera.lookAt(0, 0, 0);
    const sky = new THREE.Group();
    sky.rotation.x = 0.35;
    scene.add(sky);

    // sphere body + soft rim glow
    sky.add(new THREE.Mesh(new THREE.SphereGeometry(0.995, 64, 48), new THREE.MeshBasicMaterial({ color: 0x070712 })));
    scene.add(new THREE.Mesh(new THREE.SphereGeometry(1.06, 64, 48), new THREE.MeshBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.05, side: THREE.BackSide })));
    // graticule: meridians every 2h of RA, parallels every 30 deg
    for (let ra = 0; ra < 360; ra += 30) sky.add(line(Array.from({ length: 91 }, (_, k) => vec(ra, -90 + 2 * k)), 0x8b8da3, ra === 0 ? 0.45 : 0.16));
    for (let dec = -60; dec <= 60; dec += 30) sky.add(line(Array.from({ length: 181 }, (_, k) => vec(2 * k, dec)), 0x8b8da3, dec === 0 ? 0.4 : 0.16));
    // Milky Way plane: layered lines for a glowing band
    const mw = Array.from({ length: 361 }, (_, l) => galToEq(l));
    [[1.0, 0.9, 0x22d3ee], [1.004, 0.35, 0x8b5cf6], [0.996, 0.35, 0x3b82f6]].forEach(([r, o, c]) => sky.add(line(mw.map(([a, d]) => vec(a, d, r)), c, o)));
    for (let w = -6; w <= 6; w += 3) if (w) sky.add(line(mw.map(([a, d]) => vec(a, Math.max(-89, Math.min(89, d + w)), 1.001)), 0x8b5cf6, 0.12));
    // targets: glowing pins + HTML labels
    const pins = [];
    for (const [k, t] of Object.entries(index)) {
      const col = t.kind === "moving" ? 0x22d3ee : 0xc4b5fd, p = vec(t.ra, t.dec, 1.0);
      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.022, 16, 12), new THREE.MeshBasicMaterial({ color: col }));
      dot.position.copy(p); sky.add(dot);
      const halo = new THREE.Mesh(new THREE.SphereGeometry(0.05, 16, 12), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.22 }));
      halo.position.copy(p); sky.add(halo);
      const stem = line([vec(t.ra, t.dec, 1.0), vec(t.ra, t.dec, 1.12)], col, 0.7); sky.add(stem);
      const a = document.createElement("a");
      a.className = "glabel " + t.kind; a.href = `viewer.html?target=${k}`; a.textContent = t.label;
      host.appendChild(a);
      pins.push({ tip: vec(t.ra, t.dec, 1.14), a, halo });
    }
    // background starfield (decorative, outside the sphere)
    const sp = []; for (let i = 0; i < 900; i++) { const v = new THREE.Vector3().randomDirection ? new THREE.Vector3().randomDirection() : vec(Math.random() * 360, Math.asin(2 * Math.random() - 1) / D); sp.push(v.multiplyScalar(12 + Math.random() * 8)); }
    scene.add(new THREE.Points(new THREE.BufferGeometry().setFromPoints(sp), new THREE.PointsMaterial({ color: 0xaab4d6, size: 0.04, transparent: true, opacity: 0.6 })));

    // drag to rotate, gentle auto-spin
    let drag = null, vy = 0.0016, vx = 0;
    const el = renderer.domElement;
    el.style.cursor = "grab"; el.style.touchAction = "pan-y";
    el.addEventListener("pointerdown", (e) => { drag = { x: e.clientX, y: e.clientY }; el.setPointerCapture(e.pointerId); el.style.cursor = "grabbing"; });
    el.addEventListener("pointermove", (e) => {
      if (!drag) return;
      vy = (e.clientX - drag.x) * 0.0045; vx = (e.clientY - drag.y) * 0.0045;
      sky.rotation.y += vy; sky.rotation.x = Math.max(-1.2, Math.min(1.2, sky.rotation.x + vx));
      drag = { x: e.clientX, y: e.clientY };
    });
    const end = () => { drag = null; el.style.cursor = "grab"; };
    el.addEventListener("pointerup", end); el.addEventListener("pointercancel", end);
    window.addEventListener("resize", () => { renderer.setSize(W(), H()); camera.aspect = W() / H(); camera.updateProjectionMatrix(); });

    const tmp = new THREE.Vector3(), camDir = new THREE.Vector3();
    let t0 = performance.now();
    (function frame(now) {
      const dt = Math.min(50, now - t0); t0 = now;
      if (!drag) { vy += (0.0016 - vy) * 0.03; vx *= 0.9; sky.rotation.y += vy * dt / 16; }
      const pulse = 0.18 + 0.1 * Math.sin(now / 500);
      renderer.render(scene, camera);
      camDir.copy(camera.position).normalize();
      for (const p of pins) {
        p.halo.material.opacity = pulse;
        tmp.copy(p.tip).applyMatrix4(sky.matrixWorld);
        const front = tmp.clone().normalize().dot(camDir) > 0.05;
        tmp.project(camera);
        p.a.style.transform = `translate(${(tmp.x * 0.5 + 0.5) * W()}px, ${(-tmp.y * 0.5 + 0.5) * H()}px) translate(-50%, -100%)`;
        p.a.style.opacity = front ? 1 : 0; p.a.style.pointerEvents = front ? "auto" : "none";
      }
      requestAnimationFrame(frame);
    })(t0);
  }

  // start only when the section scrolls into view
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { io.disconnect(); start().catch(hide); } }, { rootMargin: "200px" });
    io.observe(section);
  } else start().catch(hide);
})();
