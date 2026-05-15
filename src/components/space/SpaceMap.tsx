import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  DoubleSide,
  Group,
  Line,
  LineBasicMaterial,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  PointsMaterial,
  Points as ThreePoints,
  Vector3
} from 'three';
import { BRIGHT_STARS, type CatalogStar } from '../../data/stars';
import { magToSize, raDecToVec3 } from '../../utils/coords';
import type { SkyTarget, Telescope } from '../../types/domain';

interface Props {
  target?: SkyTarget;
  telescope?: Telescope;
  className?: string;
  /** Show overlay HUD with constellation grid + telescope label. */
  hud?: boolean;
}

const SCENE_RADIUS = 80;

/**
 * Immersive 3D sky map.
 *
 * The visual stack is intentionally tiered to mimic a real wide-field
 * astronomical view:
 *
 *  1. `<DeepFieldGlow>` \u2013 a faint atmospheric rim on the far sphere so the
 *     scene never looks like a hard black box.
 *  2. `<MilkyWayBand>`  \u2013 several thousand additive points clustered along
 *     the galactic equator with a magenta/blue dust palette.
 *  3. `<StarFieldLayer>` x3 \u2013 background stars stratified by spectral colour
 *     (cool-red M majority, white G/F middle, bluewhite O/B minority) so the
 *     backdrop has the same colour distribution Hipparcos shows.
 *  4. `<CelestialGrid>` + `<GalacticPlaneOutline>` \u2013 reference frames.
 *  5. `<ConstellationLines>` \u2013 a few hand-curated asterisms (Summer/Winter
 *     Triangle, Orion, Crux, Big Dipper handle).
 *  6. `<BrightStarSprites>` \u2013 the 47-entry bright-star catalogue rendered
 *     with a per-star halo + cross spike sized by apparent magnitude.
 *  7. `<TargetModel>` \u2013 dispatched by `target.kind` so the scientifically
 *     distinct objects (M-dwarf with planets, sun-like G star, K-type
 *     exoplanet host, supermassive black hole + accretion disk) render with
 *     visually distinct, scientifically motivated geometry instead of the
 *     same generic glowing sphere.
 */
export function SpaceMap({ target, telescope, className, hud = true }: Props) {
  const [labelPos, setLabelPos] = useState<{ x: number; y: number; visible: boolean }>(
    { x: 0, y: 0, visible: false }
  );
  return (
    <div className={`relative h-full w-full overflow-hidden rounded-xl ${className ?? ''}`}>
      <Canvas
        dpr={[1, 1.75]}
        camera={{ position: [0, 0, 0.001], fov: 65, near: 0.001, far: 1000 }}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
      >
        <color attach="background" args={['#03050d']} />
        <ambientLight intensity={0.45} />
        <DeepFieldGlow />
        <MilkyWayBand count={3500} />
        <StarFieldLayer count={2400} radiusFactor={1.42} size={0.45} palette="dim" rotationSpeed={0.010} />
        <StarFieldLayer count={1500} radiusFactor={1.36} size={0.70} palette="mid" rotationSpeed={0.008} />
        <StarFieldLayer count={500} radiusFactor={1.30} size={1.20} palette="bright" rotationSpeed={0.006} twinkle />
        <CelestialGrid />
        <GalacticPlaneOutline />
        <ConstellationLines />
        <BrightStarSprites />
        {target && (
          <TargetModel
            target={target}
            onProject={(x, y, visible) => setLabelPos({ x, y, visible })}
          />
        )}
        <CameraFlight target={target} />
      </Canvas>

      {target && labelPos.visible && (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-1/2"
          style={{ left: `${labelPos.x}px`, top: `${labelPos.y}px` }}
        >
          <div className="rounded-md border border-signal-cyan/30 bg-space-950/70 px-2 py-1 font-mono text-[10px] uppercase tracking-widest text-signal-cyan backdrop-blur-md">
            {target.name}
            <div className="text-[9px] text-slate-400 normal-case tracking-normal">
              {kindLabel(target.kind)}
              {target.distanceLy ? ` · ${target.distanceLy.toLocaleString()} ly` : ''}
            </div>
          </div>
        </div>
      )}

      {hud && (
        <div className="pointer-events-none absolute inset-0 flex flex-col justify-between p-4 text-xs text-slate-400">
          <div className="flex items-center justify-between">
            <span className="font-mono uppercase tracking-widest text-signal-cyan/80">
              {`Sky frame · J2000`}
            </span>
            {telescope && (
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 font-mono text-[10px] uppercase tracking-widest backdrop-blur-md">
                {`Source · ${telescope}`}
              </span>
            )}
          </div>
          <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-widest text-slate-500">
            <span>Equatorial grid</span>
            <span>Galactic plane shown</span>
          </div>
        </div>
      )}
    </div>
  );
}

function kindLabel(kind?: SkyTarget['kind']): string {
  switch (kind) {
    case 'm-dwarf':
      return 'M-dwarf system';
    case 'k-star':
      return 'K-type star';
    case 'g-star':
      return 'G-type (Sun-like)';
    case 'smbh':
      return 'Supermassive black hole';
    default:
      return 'Sky target';
  }
}

/* ------------------------------------------------------------------------- */
/* Background atmospheres                                                    */
/* ------------------------------------------------------------------------- */

/**
 * Lazily-built radial-gradient `CanvasTexture` used by every additive Points
 * material in the scene. Without it, three.js renders each point as a flat
 * square (`PointsMaterial` has no built-in shape). One 64\u00d764 texture is
 * generated on first use and shared by every layer.
 */
let CACHED_POINT_TEXTURE: CanvasTexture | null = null;
function getSoftPointTexture(): CanvasTexture | null {
  if (CACHED_POINT_TEXTURE) return CACHED_POINT_TEXTURE;
  if (typeof document === 'undefined') return null;
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const grad = ctx.createRadialGradient(
    size / 2,
    size / 2,
    0,
    size / 2,
    size / 2,
    size / 2
  );
  grad.addColorStop(0.0, 'rgba(255,255,255,1.0)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.85)');
  grad.addColorStop(0.55, 'rgba(255,255,255,0.30)');
  grad.addColorStop(1.0, 'rgba(255,255,255,0.0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  CACHED_POINT_TEXTURE = new CanvasTexture(canvas);
  return CACHED_POINT_TEXTURE;
}

/**
 * Faint blue-violet rim sphere drawn on the far back side. Sells the
 * "interstellar dust" feel without paying for a textured cubemap.
 */
function DeepFieldGlow() {
  const geometry = useMemo(() => new BufferGeometry(), []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <mesh>
      <sphereGeometry args={[SCENE_RADIUS * 1.55, 32, 32]} />
      <meshBasicMaterial
        color="#0a1538"
        side={BackSide}
        transparent
        opacity={0.55}
        depthWrite={false}
      />
    </mesh>
  );
}

/* ------------------------------------------------------------------------- */
/* Star field (3 stratified layers + Milky Way band)                         */
/* ------------------------------------------------------------------------- */

type StarPalette = 'dim' | 'mid' | 'bright';

const PALETTE_COLORS: Record<StarPalette, string[]> = {
  // Background dim layer: dominated by cool M reds, the most numerous class
  // in any real-sky deep field (Hipparcos / Gaia colour-magnitude diagrams).
  dim: ['#f0c0a0', '#e8a878', '#d99060', '#c87858', '#a86848', '#806858'],
  // Mid layer: K and G yellows + a few F whites \u2014 the colours that dominate
  // the visible sky for the unaided eye.
  mid: ['#ffe0b0', '#fff0c8', '#ffe8a8', '#f8f0d0', '#fff5e0', '#e8f0ff'],
  // Bright layer: rare hot O/B/A blue-white giants that punch through.
  bright: ['#dfe8ff', '#cfe2ff', '#bfd6ff', '#ffe8b0', '#ffdcb0', '#ffffff']
};

/**
 * One additive Points cloud at a fixed shell radius. Distinct layers (dim /
 * mid / bright) compose into a real-sky-looking backdrop when stacked.
 */
function StarFieldLayer({
  count,
  radiusFactor,
  size,
  palette,
  rotationSpeed,
  twinkle = false
}: {
  count: number;
  radiusFactor: number;
  size: number;
  palette: StarPalette;
  rotationSpeed: number;
  twinkle?: boolean;
}) {
  const ref = useRef<ThreePoints>(null!);

  const { geometry, material } = useMemo(() => {
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const radius = SCENE_RADIUS * radiusFactor;
    const colorList = PALETTE_COLORS[palette];
    let written = 0;
    while (written < count) {
      const x = Math.random() * 2 - 1;
      const y = Math.random() * 2 - 1;
      const z = Math.random() * 2 - 1;
      const r2 = x * x + y * y + z * z;
      if (r2 < 0.01 || r2 > 1) continue;
      const norm = radius / Math.sqrt(r2);
      positions[written * 3] = x * norm;
      positions[written * 3 + 1] = y * norm;
      positions[written * 3 + 2] = z * norm;
      const c = hexToRgb(colorList[Math.floor(Math.random() * colorList.length)]);
      colors[written * 3] = c[0];
      colors[written * 3 + 1] = c[1];
      colors[written * 3 + 2] = c[2];
      written += 1;
    }
    const geom = new BufferGeometry();
    geom.setAttribute('position', new BufferAttribute(positions, 3));
    geom.setAttribute('color', new BufferAttribute(colors, 3));
    const tex = getSoftPointTexture();
    const mat = new PointsMaterial({
      size,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
      blending: AdditiveBlending,
      vertexColors: true,
      map: tex,
      alphaTest: 0.001
    });
    return { geometry: geom, material: mat };
  }, [count, radiusFactor, size, palette]);

  useEffect(() => {
    return () => {
      geometry.dispose();
      material.dispose();
    };
  }, [geometry, material]);

  useFrame((state, delta) => {
    if (ref.current) ref.current.rotation.y += delta * rotationSpeed;
    // Subtle twinkle on the bright layer only \u2014 modulates global opacity by
    // a slow sine. Cheap and avoids per-vertex shaders.
    if (twinkle) {
      material.opacity = 0.7 + 0.25 * Math.sin(state.clock.elapsedTime * 0.6);
    }
  });

  return <points ref={ref} geometry={geometry} material={material} />;
}

/**
 * Fuzzy "Milky Way" cloud band: ~`count` additive points clustered around
 * the galactic equator with a magenta/blue/violet palette to evoke
 * interstellar dust lanes. Cheaper than a textured plane and looks at home
 * with the rest of the additive scene.
 */
function MilkyWayBand({ count }: { count: number }) {
  const ref = useRef<ThreePoints>(null!);
  const { geometry, material } = useMemo(() => {
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const radius = SCENE_RADIUS * 1.1;
    const palette = ['#5b3a8a', '#7a4ea8', '#a04ea8', '#b55a8a', '#5078b8', '#3a4a8a'];
    const tilt = MathUtils.degToRad(62.6);
    for (let i = 0; i < count; i++) {
      const lon = Math.random() * Math.PI * 2;
      // Concentrate near the galactic equator (Gaussian-ish via two random
      // samples) so the band has a fuzzy edge instead of a sharp ring.
      const lat = (Math.random() + Math.random() - 1) * 0.18;
      const x = Math.cos(lon) * Math.cos(lat);
      const yy = Math.sin(lat);
      const z = Math.sin(lon) * Math.cos(lat);
      // Tilt about x to align with galactic equator in our equatorial frame.
      const ty = yy * Math.cos(tilt) - z * Math.sin(tilt);
      const tz = yy * Math.sin(tilt) + z * Math.cos(tilt);
      positions[i * 3] = x * radius;
      positions[i * 3 + 1] = ty * radius;
      positions[i * 3 + 2] = tz * radius;
      const c = hexToRgb(palette[Math.floor(Math.random() * palette.length)]);
      colors[i * 3] = c[0];
      colors[i * 3 + 1] = c[1];
      colors[i * 3 + 2] = c[2];
    }
    const geom = new BufferGeometry();
    geom.setAttribute('position', new BufferAttribute(positions, 3));
    geom.setAttribute('color', new BufferAttribute(colors, 3));
    const tex = getSoftPointTexture();
    const mat = new PointsMaterial({
      size: 0.65,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      blending: AdditiveBlending,
      vertexColors: true,
      map: tex,
      alphaTest: 0.001
    });
    return { geometry: geom, material: mat };
  }, [count]);
  useEffect(() => {
    return () => {
      geometry.dispose();
      material.dispose();
    };
  }, [geometry, material]);
  useFrame((_, delta) => {
    if (ref.current) ref.current.rotation.y += delta * 0.005;
  });
  return <points ref={ref} geometry={geometry} material={material} />;
}

/* ------------------------------------------------------------------------- */
/* Reference frames                                                          */
/* ------------------------------------------------------------------------- */

function CelestialGrid() {
  const ref = useRef<Group>(null!);
  const lines = useMemo(() => {
    const group = new Group();
    const r = SCENE_RADIUS;
    const lineMat = new LineBasicMaterial({
      color: 0x5ee0ff,
      transparent: true,
      opacity: 0.06
    });
    // RA circles (12 evenly spaced).
    for (let i = 0; i < 12; i++) {
      const ra = (i / 12) * 24;
      const pts: Vector3[] = [];
      for (let j = 0; j <= 64; j++) {
        const dec = (j / 64) * 180 - 90;
        pts.push(raDecToVec3(ra, dec, r));
      }
      const geom = new BufferGeometry().setFromPoints(pts);
      group.add(new Line(geom, lineMat));
    }
    // Dec circles.
    for (let i = -75; i <= 75; i += 15) {
      const pts: Vector3[] = [];
      for (let j = 0; j <= 96; j++) {
        const ra = (j / 96) * 24;
        pts.push(raDecToVec3(ra, i, r));
      }
      const geom = new BufferGeometry().setFromPoints(pts);
      group.add(new Line(geom, lineMat));
    }
    return group;
  }, []);
  useEffect(() => {
    if (ref.current) ref.current.add(lines);
  }, [lines]);
  return <group ref={ref} />;
}

function GalacticPlaneOutline() {
  const geometry = useMemo(() => {
    const pts: Vector3[] = [];
    for (let i = 0; i <= 128; i++) {
      const t = i / 128;
      const lon = t * Math.PI * 2;
      const x = Math.cos(lon);
      const y = Math.sin(lon);
      const tilt = MathUtils.degToRad(62.6);
      const ty = y * Math.cos(tilt);
      const tz = y * Math.sin(tilt);
      pts.push(new Vector3(x, ty, tz).multiplyScalar(SCENE_RADIUS * 0.99));
    }
    return new BufferGeometry().setFromPoints(pts);
  }, []);
  return (
    <line>
      <primitive object={geometry} attach="geometry" />
      <lineBasicMaterial color="#8b5cf6" transparent opacity={0.22} />
    </line>
  );
}

/* ------------------------------------------------------------------------- */
/* Constellations                                                            */
/* ------------------------------------------------------------------------- */

/**
 * Hand-curated asterism segments referencing entries in `BRIGHT_STARS`.
 * Only lines whose both endpoints exist in the catalogue are drawn so the
 * file can be edited without breaking the scene.
 */
const ASTERISMS: Array<{ name: string; segments: [string, string][] }> = [
  {
    name: 'Summer Triangle',
    segments: [
      ['Vega', 'Altair'],
      ['Altair', 'Deneb'],
      ['Deneb', 'Vega']
    ]
  },
  {
    name: 'Winter Triangle',
    segments: [
      ['Sirius', 'Procyon'],
      ['Procyon', 'Betelgeuse'],
      ['Betelgeuse', 'Sirius']
    ]
  },
  {
    name: 'Orion (partial)',
    segments: [
      ['Betelgeuse', 'Bellatrix'],
      ['Bellatrix', 'Alnilam'],
      ['Alnilam', 'Rigel']
    ]
  },
  {
    name: 'Crux (partial)',
    segments: [['Acrux', 'Mimosa']]
  },
  {
    name: 'Big Dipper handle',
    segments: [
      ['Alioth', 'Alkaid'],
      ['Dubhe', 'Alioth']
    ]
  }
];

function ConstellationLines() {
  const lookup = useMemo(() => {
    const map = new Map<string, CatalogStar>();
    for (const s of BRIGHT_STARS) map.set(s.name, s);
    return map;
  }, []);

  const group = useMemo(() => {
    const g = new Group();
    const mat = new LineBasicMaterial({
      color: 0x5ee0ff,
      transparent: true,
      opacity: 0.18
    });
    for (const ast of ASTERISMS) {
      for (const [a, b] of ast.segments) {
        const sa = lookup.get(a);
        const sb = lookup.get(b);
        if (!sa || !sb) continue;
        const pa = raDecToVec3(sa.raHours, sa.decDeg, SCENE_RADIUS * 0.995);
        const pb = raDecToVec3(sb.raHours, sb.decDeg, SCENE_RADIUS * 0.995);
        const geom = new BufferGeometry().setFromPoints([pa, pb]);
        g.add(new Line(geom, mat));
      }
    }
    return g;
  }, [lookup]);

  return <primitive object={group} />;
}

/* ------------------------------------------------------------------------- */
/* Bright catalogue stars (with halo + cross spike)                          */
/* ------------------------------------------------------------------------- */

function BrightStarSprites() {
  const stars = useMemo(() => {
    return BRIGHT_STARS.map((s) => {
      const pos = raDecToVec3(s.raHours, s.decDeg, SCENE_RADIUS);
      const size = magToSize(s.mag);
      return { ...s, pos, size };
    });
  }, []);

  return (
    <group>
      {stars.map((s) => (
        <BrightStar key={s.name} pos={s.pos} size={s.size} color={s.color} />
      ))}
    </group>
  );
}

function BrightStar({ pos, size, color }: { pos: Vector3; size: number; color: string }) {
  // The brightest stars in real photos bloom outward; layer a tiny core, a
  // soft additive halo, and a thin cross spike on the largest entries.
  const core = size * 0.06;
  const halo = size * 0.18;
  return (
    <group position={pos}>
      <mesh>
        <sphereGeometry args={[core, 12, 12]} />
        <meshBasicMaterial color={color} />
      </mesh>
      <mesh>
        <sphereGeometry args={[halo, 16, 16]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.18}
          depthWrite={false}
          blending={AdditiveBlending}
        />
      </mesh>
      {size > 1.8 && (
        <mesh rotation={[0, 0, Math.PI / 4]}>
          <planeGeometry args={[halo * 4, halo * 0.18]} />
          <meshBasicMaterial
            color={color}
            transparent
            opacity={0.35}
            depthWrite={false}
            blending={AdditiveBlending}
            side={DoubleSide}
          />
        </mesh>
      )}
      {size > 1.8 && (
        <mesh rotation={[0, 0, -Math.PI / 4]}>
          <planeGeometry args={[halo * 4, halo * 0.18]} />
          <meshBasicMaterial
            color={color}
            transparent
            opacity={0.35}
            depthWrite={false}
            blending={AdditiveBlending}
            side={DoubleSide}
          />
        </mesh>
      )}
    </group>
  );
}

/* ------------------------------------------------------------------------- */
/* Per-target models (dispatched by `target.kind`)                           */
/* ------------------------------------------------------------------------- */

interface TargetModelProps {
  target: SkyTarget;
  onProject: (x: number, y: number, visible: boolean) => void;
}

/**
 * Picks a scientifically inspired renderer for the focused target. Each
 * sub-renderer is a small group placed at the target's RA/Dec position; the
 * dispatcher also handles the 2D label projection so individual renderers
 * don't have to.
 */
function TargetModel({ target, onProject }: TargetModelProps) {
  const pos = useMemo(
    () => raDecToVec3(target.raHours, target.decDeg, SCENE_RADIUS * 0.96),
    [target]
  );
  const labelOffset = useMemo(() => pos.clone().multiplyScalar(0.99), [pos]);
  const groupRef = useRef<Group>(null!);
  const { camera, size } = useThree();
  const projection = useRef(new Vector3());

  useFrame(() => {
    projection.current.copy(labelOffset).project(camera);
    const x = (projection.current.x * 0.5 + 0.5) * size.width;
    const y = (-projection.current.y * 0.5 + 0.5) * size.height;
    const visible = projection.current.z >= -1 && projection.current.z <= 1;
    onProject(x, y - 36, visible);
  });

  return (
    <group ref={groupRef} position={pos}>
      {(() => {
        switch (target.kind) {
          case 'm-dwarf':
            return <MDwarfModel planetCount={target.planetCount ?? 0} />;
          case 'k-star':
            return <KStarModel planetCount={target.planetCount ?? 0} />;
          case 'g-star':
            return <GStarModel planetCount={target.planetCount ?? 0} />;
          case 'smbh':
            return <BlackHoleModel />;
          default:
            return <GenericMarker />;
        }
      })()}
      <SelectionRing />
    </group>
  );
}

/**
 * Soft cyan ring that always surrounds the focused target so the viewer can
 * spot it even when the underlying object is small (single planet, dim
 * red dwarf core). Slowly rotates.
 */
function SelectionRing() {
  const ref = useRef<Mesh>(null!);
  useFrame((_, delta) => {
    if (ref.current) ref.current.rotation.z += delta * 0.4;
  });
  return (
    <mesh ref={ref} rotation={[Math.PI / 2, 0, 0]}>
      <ringGeometry args={[1.7, 1.85, 64]} />
      <meshBasicMaterial
        color="#5ee0ff"
        transparent
        opacity={0.45}
        side={DoubleSide}
        depthWrite={false}
        blending={AdditiveBlending}
      />
    </mesh>
  );
}

/** Fallback for targets without a `kind` \u2014 the legacy cyan marker. */
function GenericMarker() {
  return (
    <group>
      <mesh>
        <sphereGeometry args={[0.45, 24, 24]} />
        <meshBasicMaterial color="#5ee0ff" />
      </mesh>
      <mesh>
        <sphereGeometry args={[0.9, 24, 24]} />
        <meshBasicMaterial
          color="#5ee0ff"
          transparent
          opacity={0.18}
          depthWrite={false}
          blending={AdditiveBlending}
        />
      </mesh>
    </group>
  );
}

/* --- Main-sequence star models ------------------------------------------- */

interface StarModelProps {
  /** Visible body radius in scene units. */
  radius: number;
  /** Hex colour of the photosphere. */
  core: string;
  /** Hex colour of the chromosphere / corona halo. */
  corona: string;
  /** Outer halo opacity (0..1). */
  haloOpacity: number;
  /** If true, slowly modulate the halo opacity to suggest stellar activity. */
  flare?: boolean;
}

/**
 * Generic main-sequence star body: photosphere sphere + corona halo. Used by
 * the M / K / G dwarf renderers below, parameterised per spectral class.
 */
function StellarBody({ radius, core, corona, haloOpacity, flare = false }: StarModelProps) {
  const haloRef = useRef<Mesh>(null!);
  useFrame((state) => {
    if (!flare || !haloRef.current) return;
    const mat = haloRef.current.material as MeshBasicMaterial;
    // Slow flare modulation tuned to look like a quiescent flare star
    // (Proxima, Wolf 359) without being distracting.
    mat.opacity =
      haloOpacity * (0.85 + 0.25 * Math.sin(state.clock.elapsedTime * 0.9));
  });
  return (
    <group>
      <mesh>
        <sphereGeometry args={[radius, 32, 32]} />
        <meshBasicMaterial color={core} />
      </mesh>
      <mesh ref={haloRef}>
        <sphereGeometry args={[radius * 1.55, 24, 24]} />
        <meshBasicMaterial
          color={core}
          transparent
          opacity={haloOpacity * 0.55}
          depthWrite={false}
          blending={AdditiveBlending}
        />
      </mesh>
      <mesh>
        <sphereGeometry args={[radius * 2.4, 24, 24]} />
        <meshBasicMaterial
          color={corona}
          transparent
          opacity={haloOpacity}
          depthWrite={false}
          blending={AdditiveBlending}
        />
      </mesh>
    </group>
  );
}

/** Cool red main-sequence star (M-dwarf). Smaller core, warm corona, flares. */
function MDwarfModel({ planetCount }: { planetCount: number }) {
  return (
    <group>
      <StellarBody
        radius={0.32}
        core="#ff6a4a"
        corona="#ff9a6a"
        haloOpacity={0.22}
        flare
      />
      <PlanetSystem count={planetCount} starRadius={0.32} palette="m-dwarf" />
    </group>
  );
}

/** Orange K-dwarf. Slightly larger and brighter than an M-dwarf. */
function KStarModel({ planetCount }: { planetCount: number }) {
  return (
    <group>
      <StellarBody radius={0.42} core="#ffb060" corona="#ffd0a0" haloOpacity={0.26} />
      <PlanetSystem count={planetCount} starRadius={0.42} palette="k-star" />
    </group>
  );
}

/** Sun-like G-type star. Yellow-white photosphere, brighter halo. */
function GStarModel({ planetCount }: { planetCount: number }) {
  return (
    <group>
      <StellarBody radius={0.55} core="#fff1c4" corona="#ffe49a" haloOpacity={0.32} />
      <PlanetSystem count={planetCount} starRadius={0.55} palette="g-star" />
    </group>
  );
}

/* --- Planet system ------------------------------------------------------- */

const PLANET_PALETTES: Record<'m-dwarf' | 'k-star' | 'g-star', string[]> = {
  // Tightly-packed inner systems around cool stars (TRAPPIST-1, Proxima):
  // small terrestrial worlds, mostly rocky/red/brown.
  'm-dwarf': ['#a86848', '#c87858', '#806858', '#9a7e60', '#7a5a4a', '#b08868', '#806050'],
  // K-dwarfs host a wider mix; lean rocky-grey-tan.
  'k-star': ['#a89878', '#7a8898', '#b09080', '#9a9a8a'],
  // G-stars span Mercury-rocks to gas-giants; vary the palette accordingly.
  'g-star': ['#c88a5a', '#c8c8b0', '#80a0c8', '#a89070']
};

/**
 * Renders up to `count` orbiting planet markers around a host star. Orbits
 * are drawn as faint cyan circles; planets revolve at slightly different
 * angular rates so the system has visible motion without strict scientific
 * accuracy.
 */
function PlanetSystem({
  count,
  starRadius,
  palette
}: {
  count: number;
  starRadius: number;
  palette: keyof typeof PLANET_PALETTES;
}) {
  const groupRef = useRef<Group>(null!);
  const planetRefs = useRef<Mesh[]>([]);
  const colors = PLANET_PALETTES[palette];

  // Compute orbit parameters once per `count` change.
  const planets = useMemo(() => {
    if (count <= 0) return [];
    const arr: { radius: number; size: number; speed: number; phase: number; color: string }[] = [];
    const minOrbit = starRadius * 2.2;
    const maxOrbit = starRadius * 2.2 + Math.max(0, count - 1) * 0.32;
    for (let i = 0; i < count; i++) {
      const t = count === 1 ? 0 : i / (count - 1);
      const radius = MathUtils.lerp(minOrbit, maxOrbit, t);
      arr.push({
        radius,
        size: 0.045 + Math.random() * 0.03,
        speed: 0.45 - i * 0.04,
        phase: (i / Math.max(1, count)) * Math.PI * 2,
        color: colors[i % colors.length]
      });
    }
    return arr;
  }, [count, starRadius, colors]);

  // Faint orbit circles (one BufferGeometry per orbit).
  const orbitLines = useMemo(() => {
    const group = new Group();
    const mat = new LineBasicMaterial({
      color: 0x5ee0ff,
      transparent: true,
      opacity: 0.14,
      depthWrite: false
    });
    for (const p of planets) {
      const pts: Vector3[] = [];
      const segs = 64;
      for (let j = 0; j <= segs; j++) {
        const a = (j / segs) * Math.PI * 2;
        pts.push(new Vector3(Math.cos(a) * p.radius, 0, Math.sin(a) * p.radius));
      }
      const geom = new BufferGeometry().setFromPoints(pts);
      group.add(new Line(geom, mat));
    }
    return group;
  }, [planets]);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    for (let i = 0; i < planets.length; i++) {
      const p = planets[i];
      const m = planetRefs.current[i];
      if (!m) continue;
      const a = p.phase + t * p.speed;
      m.position.set(Math.cos(a) * p.radius, 0, Math.sin(a) * p.radius);
    }
    if (groupRef.current) groupRef.current.rotation.y += 0.0008;
  });

  if (planets.length === 0) return null;

  return (
    <group ref={groupRef} rotation={[Math.PI / 2.4, 0, 0]}>
      <primitive object={orbitLines} />
      {planets.map((p, i) => (
        <mesh
          key={i}
          ref={(m) => {
            if (m) planetRefs.current[i] = m;
          }}
        >
          <sphereGeometry args={[p.size, 12, 12]} />
          <meshBasicMaterial color={p.color} />
        </mesh>
      ))}
    </group>
  );
}

/* --- Supermassive black hole (Sgr A*) ------------------------------------ */

/**
 * Sagittarius A*-style model:
 *   - Pitch-black event-horizon sphere at the centre.
 *   - Three nested accretion-disk rings with a yellow \u2192 orange \u2192 red
 *     temperature gradient (matches the EHT mm-wavelength images and
 *     standard relativistic-disk model colouring).
 *   - Two opposing relativistic jets along the disk's spin axis.
 */
function BlackHoleModel() {
  const diskRef = useRef<Group>(null!);
  useFrame((_, delta) => {
    if (diskRef.current) diskRef.current.rotation.y += delta * 0.35;
  });
  return (
    <group>
      {/* Event horizon */}
      <mesh>
        <sphereGeometry args={[0.32, 32, 32]} />
        <meshBasicMaterial color="#000000" />
      </mesh>
      {/* Photon ring (thin bright halo just outside the horizon) */}
      <mesh>
        <sphereGeometry args={[0.36, 32, 32]} />
        <meshBasicMaterial
          color="#ffe49a"
          transparent
          opacity={0.55}
          depthWrite={false}
          blending={AdditiveBlending}
        />
      </mesh>
      {/* Accretion disk */}
      <group ref={diskRef} rotation={[Math.PI / 2.4, 0, 0]}>
        <mesh>
          <ringGeometry args={[0.45, 0.7, 96]} />
          <meshBasicMaterial
            color="#fff0a8"
            transparent
            opacity={0.85}
            side={DoubleSide}
            depthWrite={false}
            blending={AdditiveBlending}
          />
        </mesh>
        <mesh>
          <ringGeometry args={[0.7, 1.05, 96]} />
          <meshBasicMaterial
            color="#ffa860"
            transparent
            opacity={0.65}
            side={DoubleSide}
            depthWrite={false}
            blending={AdditiveBlending}
          />
        </mesh>
        <mesh>
          <ringGeometry args={[1.05, 1.5, 96]} />
          <meshBasicMaterial
            color="#ff5a4a"
            transparent
            opacity={0.45}
            side={DoubleSide}
            depthWrite={false}
            blending={AdditiveBlending}
          />
        </mesh>
        <mesh>
          <ringGeometry args={[1.5, 1.95, 96]} />
          <meshBasicMaterial
            color="#a02a3a"
            transparent
            opacity={0.25}
            side={DoubleSide}
            depthWrite={false}
            blending={AdditiveBlending}
          />
        </mesh>
      </group>
      {/* Relativistic polar jets (cyan, additive). Cones perpendicular to disk plane. */}
      <mesh rotation={[0, 0, 0]} position={[0, 0, 0]}>
        <coneGeometry args={[0.18, 2.4, 16, 1, true]} />
        <meshBasicMaterial
          color="#5ee0ff"
          transparent
          opacity={0.35}
          depthWrite={false}
          blending={AdditiveBlending}
          side={DoubleSide}
        />
      </mesh>
      <mesh rotation={[Math.PI, 0, 0]}>
        <coneGeometry args={[0.18, 2.4, 16, 1, true]} />
        <meshBasicMaterial
          color="#5ee0ff"
          transparent
          opacity={0.35}
          depthWrite={false}
          blending={AdditiveBlending}
          side={DoubleSide}
        />
      </mesh>
    </group>
  );
}

/* ------------------------------------------------------------------------- */
/* Camera                                                                    */
/* ------------------------------------------------------------------------- */

function CameraFlight({ target }: { target?: SkyTarget }) {
  const { camera } = useThree();
  const desired = useMemo(() => {
    if (!target) return new Vector3(SCENE_RADIUS * 0.85, 0, 0);
    return raDecToVec3(target.raHours, target.decDeg, SCENE_RADIUS * 0.85);
  }, [target]);
  const lookTarget = useMemo(() => {
    if (!target) return new Vector3(SCENE_RADIUS, 0, 0);
    return raDecToVec3(target.raHours, target.decDeg, SCENE_RADIUS);
  }, [target]);
  const tmp = useRef(new Vector3()).current;

  useFrame((_, delta) => {
    camera.position.lerp(desired, Math.min(1, delta * 0.35));
    tmp.copy(lookTarget);
    camera.lookAt(tmp);
  });
  return null;
}

/* ------------------------------------------------------------------------- */
/* Helpers                                                                   */
/* ------------------------------------------------------------------------- */

/** Parse a `#rrggbb` hex string to a [r,g,b] tuple in 0..1. */
function hexToRgb(hex: string): [number, number, number] {
  const v = hex.startsWith('#') ? hex.slice(1) : hex;
  const r = parseInt(v.slice(0, 2), 16) / 255;
  const g = parseInt(v.slice(2, 4), 16) / 255;
  const b = parseInt(v.slice(4, 6), 16) / 255;
  return [r, g, b];
}
