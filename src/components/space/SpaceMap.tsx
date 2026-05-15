import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Group,
  Line,
  LineBasicMaterial,
  MathUtils,
  Mesh,
  PointsMaterial,
  Points as ThreePoints,
  Vector3
} from 'three';
import { BRIGHT_STARS } from '../../data/stars';
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
        <StarField count={3500} />
        <CelestialGrid />
        <GalacticPlane />
        <BrightStarSprites />
        {target && (
          <TargetMarker
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
            {target.distanceLy ? (
              <div className="text-[9px] text-slate-400 normal-case tracking-normal">
                {target.distanceLy.toLocaleString()} ly
              </div>
            ) : null}
          </div>
        </div>
      )}

      {hud && (
        <div className="pointer-events-none absolute inset-0 flex flex-col justify-between p-4 text-xs text-slate-400">
          <div className="flex items-center justify-between">
            <span className="font-mono uppercase tracking-widest text-signal-cyan/80">
              Sky frame · J2000
            </span>
            {telescope && (
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 font-mono text-[10px] uppercase tracking-widest backdrop-blur-md">
                Source · {telescope}
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

/**
 * Random twinkling-star backdrop. Replaces drei's `Stars` component with a
 * tiny custom Points cloud so we don't pay drei's cumulative bundle cost
 * (~250 KB raw) for a single feature on a single lazy route.
 */
function StarField({ count }: { count: number }) {
  const ref = useRef<ThreePoints>(null!);
  const geometry = useMemo(() => {
    // Distribute points uniformly on a sphere shell using the unit-cube
    // rejection method so the result looks natural (no equatorial bias).
    const positions = new Float32Array(count * 3);
    const radius = SCENE_RADIUS * 1.4;
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
      written += 1;
    }
    const geom = new BufferGeometry();
    geom.setAttribute('position', new BufferAttribute(positions, 3));
    return geom;
  }, [count]);
  const material = useMemo(() => {
    return new PointsMaterial({
      color: 0xc9d6ff,
      size: 0.45,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      blending: AdditiveBlending
    });
  }, []);
  useFrame((_, delta) => {
    if (ref.current) ref.current.rotation.y += delta * 0.012;
  });
  useEffect(() => {
    return () => {
      geometry.dispose();
      material.dispose();
    };
  }, [geometry, material]);
  return <points ref={ref} geometry={geometry} material={material} />;
}

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

function GalacticPlane() {
  const geometry = useMemo(() => {
    const pts: Vector3[] = [];
    // Approximate galactic plane sweep (simplified rotation).
    for (let i = 0; i <= 128; i++) {
      const t = i / 128;
      const lon = t * Math.PI * 2;
      const x = Math.cos(lon);
      const y = Math.sin(lon);
      // Tilt by ~62.6° about x to roughly match galactic equator.
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
      <lineBasicMaterial color="#8b5cf6" transparent opacity={0.18} />
    </line>
  );
}

function BrightStarSprites() {
  const meshes = useMemo(() => {
    return BRIGHT_STARS.map((s) => {
      const pos = raDecToVec3(s.raHours, s.decDeg, SCENE_RADIUS);
      const size = magToSize(s.mag);
      return { ...s, pos, size };
    });
  }, []);

  return (
    <group>
      {meshes.map((s) => (
        <mesh key={s.name} position={s.pos}>
          <sphereGeometry args={[s.size * 0.05, 8, 8]} />
          <meshBasicMaterial color={s.color} />
        </mesh>
      ))}
    </group>
  );
}

function TargetMarker({
  target,
  onProject
}: {
  target: SkyTarget;
  onProject: (x: number, y: number, visible: boolean) => void;
}) {
  const pos = useMemo(() => raDecToVec3(target.raHours, target.decDeg, SCENE_RADIUS * 0.96), [target]);
  const labelOffset = useMemo(() => pos.clone().multiplyScalar(0.99), [pos]);
  const ringRef = useRef<Mesh>(null!);
  const { camera, size } = useThree();
  const projection = useRef(new Vector3());
  useFrame((_, delta) => {
    if (ringRef.current) ringRef.current.rotation.z += delta * 0.4;
    projection.current.copy(labelOffset).project(camera);
    const x = (projection.current.x * 0.5 + 0.5) * size.width;
    const y = (-projection.current.y * 0.5 + 0.5) * size.height;
    const visible = projection.current.z >= -1 && projection.current.z <= 1;
    onProject(x, y - 28, visible);
  });
  return (
    <group position={pos}>
      <mesh>
        <sphereGeometry args={[0.45, 24, 24]} />
        <meshBasicMaterial color="#5ee0ff" />
      </mesh>
      <mesh>
        <sphereGeometry args={[0.9, 24, 24]} />
        <meshBasicMaterial color="#5ee0ff" transparent opacity={0.12} />
      </mesh>
      <mesh ref={ringRef} rotation={[Math.PI / 2, 0, 0]}>
        <ringGeometry args={[1.4, 1.55, 64]} />
        <meshBasicMaterial color="#5ee0ff" transparent opacity={0.55} side={DoubleSide} />
      </mesh>
    </group>
  );
}

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
    // Slowly fly the camera toward `desired`, looking at the target.
    camera.position.lerp(desired, Math.min(1, delta * 0.35));
    tmp.copy(lookTarget);
    camera.lookAt(tmp);
  });
  return null;
}
