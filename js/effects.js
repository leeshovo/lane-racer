/*
 * effects.js – Postprocessing (Bloom) und alle Partikel-Effekte.
 *
 * Ein einziges Partikelsystem (THREE.Points mit eigenem Shader) bedient
 * Funken, Explosionen, Münz-Glitzern und Power-up-Blitze. Es wird einmal
 * angelegt und danach nur noch "wiederverwendet" – pro Effekt entstehen
 * keine neuen Objekte.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const PARTICLE_COUNT = { high: 1600, medium: 800, low: 300 };
const RING_COUNT = 6;
const SPEED_LINES = 70;

const tmpColor = new THREE.Color();
const tmpVec = new THREE.Vector3();

const PARTICLE_VERTEX = `
  attribute float aSize;
  attribute float aAlpha;
  attribute vec3 aColor;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vColor = aColor;
    vAlpha = aAlpha;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * (320.0 / max(-mv.z, 0.1));
    gl_Position = projectionMatrix * mv;
  }
`;

const PARTICLE_FRAGMENT = `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec2 d = gl_PointCoord - vec2(0.5);
    float r = length(d);
    if (r > 0.5) discard;
    float a = smoothstep(0.5, 0.0, r) * vAlpha;
    gl_FragColor = vec4(vColor, a);
  }
`;

const SHIELD_VERTEX = `
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vView = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;

const SHIELD_FRAGMENT = `
  uniform float uTime;
  uniform float uOpacity;
  uniform vec3 uColor;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    float fresnel = pow(1.0 - abs(dot(normalize(vNormal), normalize(vView))), 2.2);
    float shimmer = 0.75 + 0.25 * sin(uTime * 6.0 + vNormal.y * 8.0);
    gl_FragColor = vec4(uColor * (1.4 + fresnel * 2.2), fresnel * uOpacity * shimmer);
  }
`;

export class Effects {
  constructor({ renderer, scene, camera, quality = 'high' }) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.quality = quality;
    this.time = 0;

    // Die Kamera muss im Szenengraph hängen, damit an ihr befestigte
    // Objekte (Tempo-Striche) mitgerendert werden.
    if (!camera.parent) scene.add(camera);

    this.#createParticles();
    this.#createRings();
    this.#createShield();
    this.#createSpeedLines();
    this.#createComposer();
  }

  // =========================================================================
  // Aufbau
  // =========================================================================
  #createComposer() {
    const size = this.renderer.getSize(new THREE.Vector2());
    this.composer = new EffectComposer(this.renderer);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(this.renderPass);

    if (this.quality !== 'low') {
      this.bloomPass = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.5, 0.6, 0.8);
      this.composer.addPass(this.bloomPass);
    }
    // OutputPass erledigt Tone-Mapping und sRGB am Ende der Kette
    this.composer.addPass(new OutputPass());
    this.#applyComposerScale();
  }

  #applyComposerScale() {
    if (!this.composer) return;
    const base = this.renderer.getPixelRatio();
    this.composer.setPixelRatio(this.quality === 'medium' ? base * 0.7 : base);
  }

  #createParticles() {
    const max = PARTICLE_COUNT[this.quality] ?? PARTICLE_COUNT.high;
    this.maxParticles = max;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(max * 3), 3));
    geometry.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array(max * 3), 3));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(max), 1));
    geometry.setAttribute('aAlpha', new THREE.BufferAttribute(new Float32Array(max), 1));

    this.particleMaterial = new THREE.ShaderMaterial({
      vertexShader: PARTICLE_VERTEX,
      fragmentShader: PARTICLE_FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.particles = new THREE.Points(geometry, this.particleMaterial);
    this.particles.frustumCulled = false;
    this.particles.renderOrder = 5;
    this.scene.add(this.particles);

    // Parallele Datenhaltung in einfachen Arrays (schnell, ohne Allokationen)
    this.pLife = new Float32Array(max);
    this.pMaxLife = new Float32Array(max);
    this.pVel = new Float32Array(max * 3);
    this.pGravity = new Float32Array(max);
    this.pDrag = new Float32Array(max);
    this.pSize = new Float32Array(max);
    this.pRoad = new Uint8Array(max); // 1 = bewegt sich mit der Straße mit
    this.pCursor = 0;
  }

  #createRings() {
    const geometry = new THREE.RingGeometry(0.55, 0.75, 40);
    geometry.rotateX(-Math.PI / 2);
    this.rings = [];
    for (let i = 0; i < RING_COUNT; i++) {
      const material = new THREE.MeshBasicMaterial({
        color: 0xffa040, transparent: true, opacity: 0, depthWrite: false,
        blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.visible = false;
      mesh.frustumCulled = false;
      this.scene.add(mesh);
      this.rings.push({ mesh, material, life: 0, maxLife: 0.5, grow: 14, road: true });
    }
    this.ringCursor = 0;

    // Ein einziges, fest angelegtes Blitzlicht (Lichter werden nie zur
    // Laufzeit hinzugefügt – das würde Shader-Neuübersetzungen auslösen)
    this.flashLight = new THREE.PointLight(0xffa040, 0, 26, 2);
    this.flashLight.position.set(0, 2, 0);
    this.scene.add(this.flashLight);
    this.flashLife = 0;
  }

  #createShield() {
    const geometry = new THREE.SphereGeometry(1, 24, 16);
    this.shieldMaterial = new THREE.ShaderMaterial({
      vertexShader: SHIELD_VERTEX,
      fragmentShader: SHIELD_FRAGMENT,
      uniforms: {
        uTime: { value: 0 },
        uOpacity: { value: 0.55 },
        uColor: { value: new THREE.Color('#7cf29c') },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.shieldMesh = new THREE.Mesh(geometry, this.shieldMaterial);
    this.shieldMesh.scale.set(1.7, 1.3, 3.1);
    this.shieldMesh.visible = false;
    this.shieldMesh.frustumCulled = false;
    this.scene.add(this.shieldMesh);
    this.shieldTarget = null;
  }

  #createSpeedLines() {
    const positions = new Float32Array(SPEED_LINES * 6);
    this.speedData = [];
    for (let i = 0; i < SPEED_LINES; i++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = 2.2 + Math.random() * 5;
      this.speedData.push({
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius * 0.6,
        z: -Math.random() * 40,
        len: 3 + Math.random() * 6,
        speed: 55 + Math.random() * 45,
      });
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.speedMaterial = new THREE.LineBasicMaterial({
      color: 0xbfe9ff, transparent: true, opacity: 0, depthWrite: false,
      blending: THREE.AdditiveBlending, toneMapped: false,
    });
    this.speedLines = new THREE.LineSegments(geometry, this.speedMaterial);
    this.speedLines.frustumCulled = false;
    this.speedLines.visible = false;
    this.camera.add(this.speedLines); // an der Kamera befestigt
    this.speedIntensity = 0;
  }

  // =========================================================================
  // Steuerung
  // =========================================================================
  setQuality(quality) {
    if (quality === this.quality) return;
    this.quality = quality;
    this.#applyComposerScale();
  }

  setSize(width, height) {
    this.composer?.setSize(width, height);
    this.bloomPass?.setSize(width, height);
    this.#applyComposerScale();
  }

  setBloom(bloom) {
    if (!this.bloomPass || !bloom) return;
    if (bloom.strength !== undefined) this.bloomPass.strength = bloom.strength;
    if (bloom.radius !== undefined) this.bloomPass.radius = bloom.radius;
    if (bloom.threshold !== undefined) this.bloomPass.threshold = bloom.threshold;
  }

  render(dt) {
    if (this.quality === 'low' || !this.composer) this.renderer.render(this.scene, this.camera);
    else this.composer.render(dt);
  }

  // =========================================================================
  // Effekte auslösen
  // =========================================================================

  /** Funken (Beinahe-Unfall, Schrammen). */
  sparks(position, { count = 24, color = '#ffd27a' } = {}) {
    const n = this.#scaleCount(count);
    tmpColor.set(color);
    for (let i = 0; i < n; i++) {
      this.#spawn(position, {
        color: tmpColor,
        vx: (Math.random() - 0.5) * 9,
        vy: 1 + Math.random() * 7,
        vz: 3 + Math.random() * 10,
        size: 0.1 + Math.random() * 0.12,
        life: 0.25 + Math.random() * 0.45,
        gravity: -16,
        drag: 1.6,
        road: true,
      });
    }
  }

  /** Goldenes Glitzern beim Einsammeln einer Münze. */
  coinBurst(position) {
    const n = this.#scaleCount(14);
    tmpColor.set('#ffd447');
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      this.#spawn(position, {
        color: tmpColor,
        vx: Math.cos(a) * 3.2,
        vy: 1.5 + Math.random() * 2.5,
        vz: Math.sin(a) * 3.2,
        size: 0.14,
        life: 0.35 + Math.random() * 0.2,
        gravity: -6,
        drag: 2.4,
        road: true,
      });
    }
  }

  /** Explosion: Feuerball, Rauch, Schockring und ein kurzer Lichtblitz. */
  explosion(position, { color = '#ff7a1a', scale = 1 } = {}) {
    const fire = this.#scaleCount(Math.round(34 * scale));
    tmpColor.set(color);
    for (let i = 0; i < fire; i++) {
      this.#spawn(position, {
        color: tmpColor,
        vx: (Math.random() - 0.5) * 14 * scale,
        vy: 2 + Math.random() * 11 * scale,
        vz: (Math.random() - 0.5) * 14 * scale,
        size: (0.3 + Math.random() * 0.5) * scale,
        life: 0.4 + Math.random() * 0.5,
        gravity: -10,
        drag: 1.2,
        road: true,
      });
    }
    const smoke = this.#scaleCount(Math.round(16 * scale));
    tmpColor.set('#4a4a52');
    for (let i = 0; i < smoke; i++) {
      this.#spawn(position, {
        color: tmpColor,
        vx: (Math.random() - 0.5) * 6,
        vy: 1.5 + Math.random() * 4,
        vz: (Math.random() - 0.5) * 6,
        size: (0.5 + Math.random() * 0.7) * scale,
        life: 0.7 + Math.random() * 0.6,
        gravity: 1.5,
        drag: 1.8,
        road: true,
      });
    }
    this.#ring(position, color, 15 * scale, 0.55);
    this.#flash(position, color, 26 * scale);
  }

  /** Schild zerbricht. */
  shieldBreak(position) {
    const n = this.#scaleCount(26);
    tmpColor.set('#7cf29c');
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      this.#spawn(position, {
        color: tmpColor,
        vx: Math.cos(a) * (5 + Math.random() * 4),
        vy: 1 + Math.random() * 5,
        vz: Math.sin(a) * (5 + Math.random() * 4),
        size: 0.22,
        life: 0.45 + Math.random() * 0.3,
        gravity: -9,
        drag: 1.4,
        road: true,
      });
    }
    this.#ring(position, '#7cf29c', 10, 0.45);
  }

  /** Power-up eingesammelt. */
  pickupFlash(position, color = '#00e5ff') {
    const n = this.#scaleCount(20);
    tmpColor.set(color);
    for (let i = 0; i < n; i++) {
      this.#spawn(position, {
        color: tmpColor,
        vx: (Math.random() - 0.5) * 6,
        vy: 2 + Math.random() * 5,
        vz: (Math.random() - 0.5) * 6,
        size: 0.2,
        life: 0.4 + Math.random() * 0.3,
        gravity: -4,
        drag: 2,
        road: true,
      });
    }
    this.#ring(position, color, 11, 0.4);
    this.#flash(position, color, 14);
  }

  /** Schutzschild-Blase an ein Objekt hängen (null = aus). */
  setShield(object) {
    this.shieldTarget = object || null;
    this.shieldMesh.visible = Boolean(object);
  }

  /** Tempo-Striche: 0 = aus, 1 = volle Nitro-Wucht. */
  setSpeedLines(intensity) {
    this.speedIntensity = Math.max(0, Math.min(1, intensity || 0));
  }

  // =========================================================================
  // Pro Frame
  // =========================================================================
  update(dt, { worldSpeed = 0, speedRatio = 0, nitro = false } = {}) {
    this.time += dt;
    this.#updateParticles(dt, worldSpeed);
    this.#updateRings(dt, worldSpeed);
    this.#updateShield(dt);
    this.#updateSpeedLines(dt, speedRatio, nitro);

    if (this.flashLife > 0) {
      this.flashLife = Math.max(0, this.flashLife - dt * 4);
      this.flashLight.intensity = this.flashLife * this.flashPeak;
    }
  }

  #updateParticles(dt, worldSpeed) {
    const geo = this.particles.geometry;
    const pos = geo.attributes.position.array;
    const alpha = geo.attributes.aAlpha.array;
    const size = geo.attributes.aSize.array;
    let alive = false;

    for (let i = 0; i < this.maxParticles; i++) {
      if (this.pLife[i] <= 0) continue;
      alive = true;
      const i3 = i * 3;
      this.pLife[i] -= dt;
      if (this.pLife[i] <= 0) {
        alpha[i] = 0;
        size[i] = 0;
        continue;
      }
      const drag = Math.max(0, 1 - this.pDrag[i] * dt);
      this.pVel[i3] *= drag;
      this.pVel[i3 + 1] = this.pVel[i3 + 1] * drag + this.pGravity[i] * dt;
      this.pVel[i3 + 2] *= drag;

      pos[i3] += this.pVel[i3] * dt;
      pos[i3 + 1] += this.pVel[i3 + 1] * dt;
      pos[i3 + 2] += this.pVel[i3 + 2] * dt + (this.pRoad[i] ? worldSpeed * dt : 0);

      const t = this.pLife[i] / this.pMaxLife[i];
      alpha[i] = t;
      size[i] = this.pSize[i] * (0.4 + t * 0.6);
    }

    if (alive || this.particlesDirty) {
      geo.attributes.position.needsUpdate = true;
      geo.attributes.aAlpha.needsUpdate = true;
      geo.attributes.aSize.needsUpdate = true;
      geo.attributes.aColor.needsUpdate = true;
      this.particlesDirty = alive;
    }
  }

  #updateRings(dt, worldSpeed) {
    for (const ring of this.rings) {
      if (ring.life <= 0) continue;
      ring.life -= dt;
      if (ring.life <= 0) {
        ring.mesh.visible = false;
        continue;
      }
      const t = 1 - ring.life / ring.maxLife;
      const s = 0.4 + t * ring.grow;
      ring.mesh.scale.set(s, 1, s);
      ring.mesh.position.z += worldSpeed * dt;
      ring.material.opacity = (1 - t) * 0.85;
    }
  }

  #updateShield(dt) {
    if (!this.shieldTarget) return;
    this.shieldMaterial.uniforms.uTime.value = this.time;
    this.shieldMesh.position.copy(this.shieldTarget.position);
    this.shieldMesh.position.y += 0.75;
    this.shieldMesh.rotation.y += dt * 0.6;
  }

  #updateSpeedLines(dt, speedRatio, nitro) {
    const target = Math.max(this.speedIntensity, nitro ? 1 : 0);
    const visible = target > 0.02;
    this.speedLines.visible = visible;
    if (!visible) {
      this.speedMaterial.opacity = 0;
      return;
    }
    this.speedMaterial.opacity = 0.15 + target * 0.5;
    const array = this.speedLines.geometry.attributes.position.array;
    const boost = 1 + target * 1.6 + speedRatio;
    for (let i = 0; i < SPEED_LINES; i++) {
      const line = this.speedData[i];
      line.z += line.speed * boost * dt;
      if (line.z > 6) line.z = -45 - Math.random() * 20;
      const i6 = i * 6;
      array[i6] = line.x;
      array[i6 + 1] = line.y;
      array[i6 + 2] = line.z;
      array[i6 + 3] = line.x;
      array[i6 + 4] = line.y;
      array[i6 + 5] = line.z - line.len * (0.6 + target);
    }
    this.speedLines.geometry.attributes.position.needsUpdate = true;
  }

  // =========================================================================
  // Interna
  // =========================================================================
  #scaleCount(count) {
    const factor = this.quality === 'low' ? 0.35 : this.quality === 'medium' ? 0.65 : 1;
    return Math.max(3, Math.round(count * factor));
  }

  #spawn(position, opts) {
    const i = this.pCursor;
    this.pCursor = (this.pCursor + 1) % this.maxParticles;
    const i3 = i * 3;
    const geo = this.particles.geometry;
    const pos = geo.attributes.position.array;
    const col = geo.attributes.aColor.array;

    pos[i3] = position.x;
    pos[i3 + 1] = position.y;
    pos[i3 + 2] = position.z;
    col[i3] = opts.color.r;
    col[i3 + 1] = opts.color.g;
    col[i3 + 2] = opts.color.b;
    this.pVel[i3] = opts.vx;
    this.pVel[i3 + 1] = opts.vy;
    this.pVel[i3 + 2] = opts.vz;
    this.pLife[i] = opts.life;
    this.pMaxLife[i] = opts.life;
    this.pGravity[i] = opts.gravity ?? -10;
    this.pDrag[i] = opts.drag ?? 1.5;
    this.pSize[i] = opts.size ?? 0.2;
    this.pRoad[i] = opts.road ? 1 : 0;
    geo.attributes.aSize.array[i] = this.pSize[i];
    geo.attributes.aAlpha.array[i] = 1;
    this.particlesDirty = true;
  }

  #ring(position, color, grow, life) {
    const ring = this.rings[this.ringCursor];
    this.ringCursor = (this.ringCursor + 1) % RING_COUNT;
    ring.mesh.position.set(position.x, 0.12, position.z);
    ring.mesh.scale.set(0.4, 1, 0.4);
    ring.mesh.visible = true;
    ring.material.color.set(color);
    ring.material.opacity = 0.85;
    ring.life = life;
    ring.maxLife = life;
    ring.grow = grow;
  }

  #flash(position, color, intensity) {
    if (this.quality === 'low') return;
    this.flashLight.position.set(position.x, position.y + 1, position.z);
    this.flashLight.color.set(color);
    this.flashPeak = intensity;
    this.flashLife = 1;
    this.flashLight.intensity = intensity;
  }

  dispose() {
    this.particles.geometry.dispose();
    this.particleMaterial.dispose();
    this.scene.remove(this.particles);
    for (const ring of this.rings) {
      ring.material.dispose();
      this.scene.remove(ring.mesh);
    }
    this.rings[0]?.mesh.geometry.dispose();
    this.shieldMesh.geometry.dispose();
    this.shieldMaterial.dispose();
    this.scene.remove(this.shieldMesh);
    this.speedLines.geometry.dispose();
    this.speedMaterial.dispose();
    this.camera.remove(this.speedLines);
    this.scene.remove(this.flashLight);
    this.composer?.dispose?.();
  }
}
