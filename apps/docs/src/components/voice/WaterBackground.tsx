"use client";

import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
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
const PATH_STEP = 16;

/**
 * Keyframes live with the component. Each wave layer is its own HTML element
 * animating only `transform`, so the browser composites the pre-rendered
 * layers on the GPU instead of repainting a full-screen SVG every frame.
 */
const WATER_CSS = `
@keyframes wb-drift {
  from { transform: translate3d(0, 0, 0); }
  to { transform: translate3d(calc(-1 * var(--wb-drift, 200px)), 0, 0); }
}
@keyframes wb-swell {
  0% { transform: scaleY(1); }
  35% { transform: scaleY(1.35); }
  100% { transform: scaleY(1); }
}
.wb-layer {
  animation: wb-drift linear infinite;
  will-change: transform;
}
.wb-body--splash { animation: wb-swell 1.5s ease-out; }
.wb-paused .wb-layer, .wb-paused .wb-body--splash { animation-play-state: paused; }
@media (prefers-reduced-motion: reduce) {
  .wb-layer, .wb-body--splash { animation: none; }
}
`;

/**
 * One wave tile spanning `0..width + waveLen`, with the crest line at
 * `top`. Drifting it left by exactly one `waveLen` is seamless because `sin`
 * has period `waveLen`; the extra wavelength keeps the right edge covered.
 */
function waveTilePath(
  width: number,
  height: number,
  top: number,
  amp: number,
  waveLen: number,
): string {
  const totalWidth = width + waveLen + PATH_STEP;
  let d = `M 0 ${top.toFixed(1)}`;
  for (let x = PATH_STEP; x <= totalWidth; x += PATH_STEP) {
    const y = top + Math.sin((x / waveLen) * Math.PI * 2) * amp;
    d += ` L ${x.toFixed(1)} ${y.toFixed(1)}`;
  }
  d += ` L ${totalWidth.toFixed(1)} ${height} L 0 ${height} Z`;
  return d;
}

// --- Environment subscriptions (reduced motion, page visibility) ----------

function subscribeReducedMotion(cb: () => void) {
  const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}
const getReducedMotion = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function subscribeVisibility(cb: () => void) {
  document.addEventListener("visibilitychange", cb);
  return () => document.removeEventListener("visibilitychange", cb);
}
const getHidden = () => document.visibilityState === "hidden";
const serverFalse = () => false;

// --- Particles (Web Animations API — starts when mounted, unlike SMIL) ----

function Drop({ x, delay, waterY }: { x: number; delay: number; waterY: number }) {
  const dropRef = useRef<HTMLDivElement>(null);
  const rippleRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const drop = dropRef.current;
    const ripple = rippleRef.current;
    if (!drop?.animate || !ripple?.animate) return;
    const animations = [
      drop.animate(
        [
          // The 8px drop's centre falls from y = -12 to the waterline.
          { transform: "translate3d(0, -16px, 0)", opacity: 0.85 },
          { opacity: 0.85, offset: 0.85 },
          { transform: `translate3d(0, ${waterY - 4}px, 0)`, opacity: 0 },
        ],
        {
          duration: DROP_FALL_MS,
          delay,
          easing: "cubic-bezier(0.4, 0, 1, 1)",
          fill: "both",
        },
      ),
      ripple.animate(
        [
          { transform: "scale(0.045, 0.09)", opacity: 0 },
          { opacity: 0.5, offset: 0.5 },
          { transform: "scale(1, 1)", opacity: 0 },
        ],
        { duration: RIPPLE_MS, delay: delay + DROP_FALL_MS, fill: "both" },
      ),
    ];
    return () => animations.forEach((a) => a.cancel());
  }, [delay, waterY]);

  return (
    <>
      <div
        ref={dropRef}
        className="absolute top-0 h-2 w-2 rounded-full bg-current"
        style={{ left: x - 4, opacity: 0, willChange: "transform, opacity" }}
      />
      <div
        ref={rippleRef}
        className="absolute rounded-[50%] border-[1.5px] border-current"
        style={{
          left: x - 44,
          top: waterY - 11,
          width: 88,
          height: 22,
          opacity: 0,
          willChange: "transform, opacity",
        }}
      />
    </>
  );
}

function Sink({ x, delay, waterY }: { x: number; delay: number; waterY: number }) {
  const bubbleRef = useRef<HTMLDivElement>(null);
  const dipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const bubble = bubbleRef.current;
    const dip = dipRef.current;
    if (!bubble?.animate || !dip?.animate) return;
    const animations = [
      bubble.animate(
        [
          { transform: "translate3d(0, 0, 0)", opacity: 0 },
          { opacity: 0.7, offset: 0.5 },
          { transform: "translate3d(0, 70px, 0)", opacity: 0 },
        ],
        {
          duration: SINK_MS,
          delay,
          easing: "cubic-bezier(0.2, 0, 0.8, 1)",
          fill: "both",
        },
      ),
      // Inward dip at the surface where the field left.
      dip.animate(
        [
          { transform: "scaleX(1)", opacity: 0 },
          { opacity: 0.4, offset: 0.5 },
          { transform: "scaleX(0.067)", opacity: 0 },
        ],
        { duration: SINK_MS, delay, fill: "both" },
      ),
    ];
    return () => animations.forEach((a) => a.cancel());
  }, [delay]);

  return (
    <>
      <div
        ref={bubbleRef}
        className="absolute h-2 w-2 rounded-full bg-current"
        style={{ left: x - 4, top: waterY - 4, opacity: 0, willChange: "transform, opacity" }}
      />
      <div
        ref={dipRef}
        className="absolute rounded-[50%] border-[1.5px] border-current"
        style={{
          left: x - 30,
          top: waterY - 8,
          width: 60,
          height: 16,
          opacity: 0,
          willChange: "transform, opacity",
        }}
      />
    </>
  );
}

/**
 * Ambient, calm-by-default water rendered behind the full-screen record mode.
 * Purely decorative (`pointer-events-none`); honors reduced-motion by falling
 * back to a static gradient and turning every trigger into a no-op, and
 * pauses while the page is hidden. Memoized: parent re-renders (live captions,
 * log entries) never touch it — it only re-renders on resize and events.
 */
const WaterBackgroundImpl = forwardRef<WaterHandle, { enabled?: boolean }>(
  function WaterBackground({ enabled = true }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [size, setSize] = useState({ w: 0, h: 0 });
    const reduced = useSyncExternalStore(
      subscribeReducedMotion,
      getReducedMotion,
      serverFalse,
    );
    const hidden = useSyncExternalStore(
      subscribeVisibility,
      getHidden,
      serverFalse,
    );
    const [particles, setParticles] = useState<Particle[]>([]);
    const [splashing, setSplashing] = useState(false);
    const particleSeq = useRef(0);
    const timers = useRef(new Set<ReturnType<typeof setTimeout>>());

    // Track the container's pixel size so drops stay round and land on the line.
    useEffect(() => {
      if (!enabled || reduced) return;
      const el = containerRef.current;
      if (!el) return;
      const measure = () => {
        const next = { w: el.clientWidth, h: el.clientHeight };
        setSize((prev) =>
          prev.w === next.w && prev.h === next.h ? prev : next,
        );
      };
      measure();
      const ro = new ResizeObserver(measure);
      ro.observe(el);
      return () => ro.disconnect();
    }, [enabled, reduced]);

    useEffect(() => {
      const pending = timers.current;
      return () => {
        pending.forEach((t) => clearTimeout(t));
        pending.clear();
      };
    }, []);

    const later = useCallback((fn: () => void, ms: number) => {
      const t = setTimeout(() => {
        timers.current.delete(t);
        fn();
      }, ms);
      timers.current.add(t);
    }, []);

    const addParticles = useCallback(
      (kind: ParticleKind, count: number) => {
        if (!enabled || reduced || hidden || size.w === 0) return;
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
          (kind === "sink" ? SINK_MS : PARTICLE_LIFETIME_MS) + (n - 1) * 120;
        later(
          () => setParticles((prev) => prev.filter((p) => !ids.has(p.id))),
          lifetime,
        );
      },
      [enabled, reduced, hidden, size.w, later],
    );

    useImperativeHandle(
      ref,
      (): WaterHandle => ({
        splash: () => {
          if (!enabled || reduced || hidden) return;
          setSplashing(true);
          later(() => setSplashing(false), 1500);
        },
        drop: (count = 1) => addParticles("drop", count),
        sink: (count = 1) => addParticles("sink", count),
      }),
      [enabled, reduced, hidden, addParticles, later],
    );

    const { w, h } = size;
    const waterY = h * WATERLINE;

    // Each layer only covers the water (crest to bottom), not the screen.
    const layers = useMemo(
      () =>
        w > 0 && h > 0
          ? WAVE_LAYERS.map((layer) => {
              const top = Math.max(0, waterY + layer.offset - layer.amp - 2);
              const height = Math.max(1, h - top);
              const width = w + layer.waveLen + PATH_STEP;
              return {
                ...layer,
                top,
                width,
                height,
                d: waveTilePath(
                  w,
                  height,
                  waterY + layer.offset - top,
                  layer.amp,
                  layer.waveLen,
                ),
              };
            })
          : [],
      [w, h, waterY],
    );

    if (!enabled) return null;

    // Reduced motion: a still, translucent gradient — the metaphor without movement.
    if (reduced) {
      return (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-0 overflow-hidden"
        >
          <div className="absolute inset-x-0 bottom-0 h-[36%] bg-linear-to-t from-brand-accent/20 to-transparent" />
        </div>
      );
    }

    return (
      <div
        ref={containerRef}
        aria-hidden
        className={`pointer-events-none absolute inset-0 z-0 overflow-hidden text-brand-accent${hidden ? " wb-paused" : ""}`}
      >
        <style>{WATER_CSS}</style>

        {/* Water body: stacked drifting wave layers, swelling on splash. */}
        <div
          className={splashing ? "wb-body--splash absolute inset-0" : "absolute inset-0"}
          style={{ transformOrigin: "center bottom", willChange: splashing ? "transform" : undefined }}
        >
          {layers.map((layer, i) => (
            <div
              key={i}
              className="wb-layer absolute left-0"
              style={
                {
                  top: layer.top,
                  width: layer.width,
                  height: layer.height,
                  animationDuration: `${layer.drift}s`,
                  animationDirection: layer.dir === 1 ? "normal" : "reverse",
                  "--wb-drift": `${layer.waveLen}px`,
                } as CSSProperties
              }
            >
              <svg
                width={layer.width}
                height={layer.height}
                viewBox={`0 0 ${layer.width} ${layer.height}`}
                className="block"
              >
                <path d={layer.d} fill="currentColor" opacity={layer.opacity} />
              </svg>
            </div>
          ))}
        </div>

        {/* Falling drops (added fields) and sinks (removed fields). */}
        {particles.map((p) =>
          p.kind === "drop" ? (
            <Drop key={p.id} x={p.x} delay={p.delay} waterY={waterY} />
          ) : (
            <Sink key={p.id} x={p.x} delay={p.delay} waterY={waterY} />
          ),
        )}
      </div>
    );
  },
);

export const WaterBackground = memo(WaterBackgroundImpl);
