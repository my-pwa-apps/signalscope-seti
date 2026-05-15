import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Stars, Html } from '@react-three/drei';
import { useEffect, useMemo, useRef } from 'react';
import {
  BufferGeometry,
  DoubleSide,
  Group,
  Line,
  LineBasicMaterial,
  MathUtils,
  Mesh,
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
  return (
    <div className={`relative h-full w-full overflow-hidden rounded-xl ${className ?? ''}`}>
      <Canvas
        dpr={[1, 1.75]}
        camera={{ position: [0, 0, 0.001], fov: 65, near: 0.001, far: 1000 }}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
      >
        <color attach="background" args={['#03050d']} />
        <ambientLight intensity={0.45} />
        <Stars
          radius={SCENE_RADIUS * 1.4}
          depth={40}
          count={3500}
          factor={2.4}
          saturation={0}
          fade
          speed={0.4}
        />
        <CelestialGrid />
        <GalacticPlane />
        <BrightStarSprites />
        {target && <TargetMarker target={target} />}
        <CameraFlight target={target} />
      </Canvas>

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

function TargetMarker({ target }: { target: SkyTarget }) {
  const pos = useMemo(() => raDecToVec3(target.raHours, target.decDeg, SCENE_RADIUS * 0.96), [target]);
  const ringRef = useRef<Mesh>(null!);
  useFrame((_, delta) => {
    if (ringRef.current) ringRef.current.rotation.z += delta * 0.4;
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
      <Html
        position={[1.6, 0.6, 0]}
        center={false}
        wrapperClass="pointer-events-none"
        style={{ pointerEvents: 'none' }}
      >
        <div className="rounded-md border border-signal-cyan/30 bg-space-950/70 px-2 py-1 font-mono text-[10px] uppercase tracking-widest text-signal-cyan backdrop-blur-md">
          {target.name}
          {target.distanceLy ? (
            <div className="text-[9px] text-slate-400 normal-case tracking-normal">
              {target.distanceLy.toLocaleString()} ly
            </div>
          ) : null}
        </div>
      </Html>
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
