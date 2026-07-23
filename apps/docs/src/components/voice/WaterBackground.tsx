"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type CSSProperties,
} from "react";

/**
 * Imperative handle for the ambient water background. Record mode holds a ref
 * and fires these one-shot events as the schema changes during a dictation
 * session — the water is a legible, honest readout of what the pipeline did.
 */
export interface WaterHandle {
  /** Reshape (full regen / voice edit): swell the whole surface briefly. */
  splash: (intensity?: number) => void;
  /** One or more fields were added: drops fall from the top and ripple. */
  drop: (count?: number) => void;
  /** One or more fields were removed: the surface dips and sinks. */
  sink: (count?: number) => void;
}

type ParticleKind = "drop" | "sink";

interface Particle {
  id: number;
  kind: ParticleKind;
  /** Horizontal landing point, in pixels within the current viewport. */
  x: number;
  /** Stagger offset so a burst reads as a sequence, not a single splat. */
  delay: number;
}

// Three parallax wave layers. Nearer layers are taller, more opaque, faster.
const WAVE_LAYERS = [
  { amp: 10, waveLen: 320, offset: 0, opacity: 0.1, drift: 13, dir: 1 },
  { amp: 14, waveLen: 260, offset: 10, opacity: 0.14, drift: 9, dir: -1 },
  { amp: 20, waveLen: 200, offset: 22, opacity: 0.2, drift: 6, dir: 1 },
];

// The water surface sits this fraction down the screen; drops land here.
const WATERLINE = 0.64;

const DROP_FALL_MS = 900;
const RIPPLE_MS = 1000;
const SINK_MS = 1300;
const PARTICLE_LIFETIME_MS = DROP_FALL_MS + RIPPLE_MS + 400;

/**
 * Build a filled wave path spanning `0..width + waveLen`. Drifting it left by
 * exactly one `waveLen` (see the `water-drift` keyframe) is seamless because
 * `sin` has period `waveLen`, and the extra wavelength of width keeps the right
 * edge covered for the whole shift. Sampled as a smooth polyline, then closed
 * to the bottom to form a body of water.
 */
function waveTilePath(
  width: number,
  height: number,
  baseY: number,
  amp: number,
  waveLen: number,
): string {
  const step = 16;
  const totalWidth = width + waveLen + step;
  let d = `M 0 ${baseY.toFixed(1)}`;
  for (let x = step; x <= totalWidth; x += step) {
    const y = baseY + Math.sin((x / waveLen) * Math.PI * 2) * amp;
    d += ` L ${x.toFixed(1)} ${y.toFixed(1)}`;
  }
  d += ` L ${totalWidth.toFixed(1)} ${height} L 0 ${height} Z`;
  return d;
}

/**
 * Ambient, calm-by-default water rendered behind the full-screen record mode.
 * Purely decorative (`pointer-events-none`); honors reduced-motion by falling
 * back to a static gradient and turning every trigger into a no-op.
 */
export const WaterBackground = forwardRef<
  WaterHandle,
  { enabled?: boolean }
>(function WaterBackground({ enabled = true }, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [reduced, setReduced] = useState(false);
  const [particles, setParticles] = useState<Particle[]>([]);
  const [splashing, setSplashing] = useState(false);
  const particleSeq = useRef(0);
  const splashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Track the container's pixel size so drops stay round and land on the line.
  useEffect(() => {
    if (!enabled) return;
    const el = containerRef.current;
    if (!el) return;
    const measure = () =>
      setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [enabled]);

  // Respect the user's reduced-motion preference.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  const addParticles = useCallback(
    (kind: ParticleKind, count: number) => {
      if (!enabled || reduced || size.w === 0) return;
      const n = Math.max(1, count);
      const created: Particle[] = Array.from({ length: n }, (_, i) => ({
        id: particleSeq.current++,
        kind,
        // Spread the burst across the middle 80% of the width.
        x: size.w * (0.1 + Math.random() * 0.8),
        delay: i * 120,
      }));
      setParticles((prev) => [...prev, ...created]);
      const ids = new Set(created.map((p) => p.id));
      const lifetime =
        (kind === "sink" ? SINK_MS : PARTICLE_LIFETIME_MS) +
        (n - 1) * 120;
      setTimeout(
        () => setParticles((prev) => prev.filter((p) => !ids.has(p.id))),
        lifetime,
      );
    },
    [enabled, reduced, size.w],
  );

  useImperativeHandle(
    ref,
    (): WaterHandle => ({
      splash: () => {
        if (!enabled || reduced) return;
        setSplashing(true);
        if (splashTimer.current) clearTimeout(splashTimer.current);
        splashTimer.current = setTimeout(() => setSplashing(false), 1500);
      },
      drop: (count = 1) => addParticles("drop", count),
      sink: (count = 1) => addParticles("sink", count),
    }),
    [enabled, reduced, addParticles],
  );

  useEffect(
    () => () => {
      if (splashTimer.current) clearTimeout(splashTimer.current);
    },
    [],
  );

  if (!enabled) return null;

  // Reduced motion: a still, translucent gradient — the metaphor without movement.
  if (reduced) {
    return (
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-0 overflow-hidden"
      >
        <div className="absolute inset-x-0 bottom-0 h-[36%] bg-gradient-to-t from-brand-accent/20 to-transparent" />
      </div>
    );
  }

  const { w, h } = size;
  const waterY = h * WATERLINE;

  return (
    <div
      ref={containerRef}
      aria-hidden
      className="pointer-events-none absolute inset-0 z-0 overflow-hidden text-brand-accent"
    >
      {w > 0 && h > 0 && (
        <svg
          width={w}
          height={h}
          viewBox={`0 0 ${w} ${h}`}
          className="absolute inset-0"
          preserveAspectRatio="none"
        >
          {/* Water body: stacked drifting wave layers, swelling on splash. */}
          <g
            className={splashing ? "water-body water-body--splash" : "water-body"}
            style={{
              transformBox: "view-box",
              transformOrigin: "center bottom",
            }}
          >
            {WAVE_LAYERS.map((layer, i) => (
              <g
                key={i}
                className="water-drift"
                style={
                  {
                    animationDuration: `${layer.drift}s`,
                    animationDirection:
                      layer.dir === 1 ? "normal" : "reverse",
                    "--water-drift": `${layer.waveLen}px`,
                  } as CSSProperties
                }
              >
                <path
                  d={waveTilePath(
                    w,
                    h,
                    waterY + layer.offset,
                    layer.amp,
                    layer.waveLen,
                  )}
                  fill="currentColor"
                  opacity={layer.opacity}
                />
              </g>
            ))}
          </g>

          {/* Falling drops (added fields) and sinks (removed fields). */}
          {particles.map((p) =>
            p.kind === "drop" ? (
              <g key={p.id}>
                <circle cx={p.x} cy={-12} r={4} fill="currentColor" opacity={0.85}>
                  <animate
                    attributeName="cy"
                    values={`-12;${waterY.toFixed(1)}`}
                    dur={`${DROP_FALL_MS}ms`}
                    begin={`${p.delay}ms`}
                    calcMode="spline"
                    keyTimes="0;1"
                    keySplines="0.4 0 1 1"
                    fill="freeze"
                  />
                  <animate
                    attributeName="opacity"
                    values="0.85;0.85;0"
                    keyTimes="0;0.85;1"
                    dur={`${DROP_FALL_MS}ms`}
                    begin={`${p.delay}ms`}
                    fill="freeze"
                  />
                </circle>
                <ellipse
                  cx={p.x}
                  cy={waterY}
                  rx={2}
                  ry={1}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.5}
                  opacity={0}
                >
                  <animate
                    attributeName="rx"
                    values="2;44"
                    dur={`${RIPPLE_MS}ms`}
                    begin={`${p.delay + DROP_FALL_MS}ms`}
                    fill="freeze"
                  />
                  <animate
                    attributeName="ry"
                    values="1;11"
                    dur={`${RIPPLE_MS}ms`}
                    begin={`${p.delay + DROP_FALL_MS}ms`}
                    fill="freeze"
                  />
                  <animate
                    attributeName="opacity"
                    values="0;0.5;0"
                    dur={`${RIPPLE_MS}ms`}
                    begin={`${p.delay + DROP_FALL_MS}ms`}
                    fill="freeze"
                  />
                </ellipse>
              </g>
            ) : (
              <g key={p.id}>
                <circle cx={p.x} cy={waterY} r={4} fill="currentColor" opacity={0}>
                  <animate
                    attributeName="cy"
                    values={`${waterY.toFixed(1)};${(waterY + 70).toFixed(1)}`}
                    dur={`${SINK_MS}ms`}
                    begin={`${p.delay}ms`}
                    calcMode="spline"
                    keyTimes="0;1"
                    keySplines="0.2 0 0.8 1"
                    fill="freeze"
                  />
                  <animate
                    attributeName="opacity"
                    values="0;0.7;0"
                    dur={`${SINK_MS}ms`}
                    begin={`${p.delay}ms`}
                    fill="freeze"
                  />
                </circle>
                {/* Inward dip at the surface where the field left. */}
                <ellipse
                  cx={p.x}
                  cy={waterY}
                  rx={30}
                  ry={8}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.5}
                  opacity={0}
                >
                  <animate
                    attributeName="rx"
                    values="30;2"
                    dur={`${SINK_MS}ms`}
                    begin={`${p.delay}ms`}
                    fill="freeze"
                  />
                  <animate
                    attributeName="opacity"
                    values="0;0.4;0"
                    dur={`${SINK_MS}ms`}
                    begin={`${p.delay}ms`}
                    fill="freeze"
                  />
                </ellipse>
              </g>
            ),
          )}
        </svg>
      )}
    </div>
  );
});
