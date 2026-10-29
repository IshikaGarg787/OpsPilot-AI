import { motion, useReducedMotion, useScroll, useTransform } from 'framer-motion';
import { useRef } from 'react';

/** Lightweight CSS 3D dispatch scene; keeps the landing and auth bundles dependency-free. */
export function DispatchScenePanel({ variant, className = '' }: { variant: 'landing' | 'auth'; className?: string }) {
  const sceneRef = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: sceneRef, offset: ['start end', 'end start'] });
  const travel = useTransform(scrollYProgress, [0, 1], [0, -18]);

  return (
    <div ref={sceneRef} className={`dispatch-scene-panel ${className}`} aria-hidden="true">
      <motion.div className="dispatch-css-scene" style={reduceMotion ? undefined : { y: travel }}>
        <div className="dispatch-conveyor">
          <div className="dispatch-conveyor-belt" />
          <div className="dispatch-conveyor-rail rail-left" />
          <div className="dispatch-conveyor-rail rail-right" />
          <div className="dispatch-scene-stages">
            <span><b>01</b> Risk</span><span><b>02</b> Time</span><span><b>03</b> Load</span>
          </div>
          <div className="dispatch-gates"><i /><i /><i /></div>
          <div className="dispatch-parcels"><i /><i /><i /><i /><i /></div>
        </div>
      </motion.div>
    </div>
  );
}
