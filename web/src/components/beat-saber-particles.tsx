"use client";

import { useEffect, useRef, useState } from "react";

const COLOR = "#fff";
const DENSITY_AREA = 1100 * 900;
const DENSITY_COUNT = 96;
const SPEED_MIN = 0.08;
const SPEED_MAX = 0.36;
const OPACITY_MIN = 0.16;
const OPACITY_MAX = 0.85;
const OPACITY_SPEED = 0.45;
const SIZE_MIN = 0.7;
const SIZE_MAX = 2.3;
const SIZE_SPEED = 1.8;
const Z_LAYERS = 100;
const Z_VALUE_MAX = 8;
const Z_OPACITY_RATE = 0.7;
const ANIMATION_SPEED_SCALE = 1 / 100;
const MOVE_SPEED_SCALE = 0.5;
const SPREAD = Math.PI / 4;
const FRAME_MS = 1000 / 60;
const MAX_FRAME_STEP = 5;
const TAU = Math.PI * 2;

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  sizeVelocity: number;
  opacity: number;
  opacityVelocity: number;
  depthScale: number;
  depthAlpha: number;
};

function createParticle(width: number, height: number, animated: boolean): Particle {
  const depth = 1 - Math.floor(Math.random() * Z_VALUE_MAX) / Z_LAYERS;
  const angle = -Math.PI / 2 - SPREAD + Math.random() * SPREAD * 2;
  const step = (SPEED_MIN + Math.random() * (SPEED_MAX - SPEED_MIN)) * MOVE_SPEED_SCALE * depth;

  return {
    x: Math.random() * width,
    y: Math.random() * height,
    vx: animated ? Math.cos(angle) * step : 0,
    vy: animated ? Math.sin(angle) * step : 0,
    size: SIZE_MIN + Math.random() * (SIZE_MAX - SIZE_MIN),
    sizeVelocity: animated
      ? SIZE_SPEED * ANIMATION_SPEED_SCALE * Math.random() * (Math.random() >= 0.5 ? 1 : -1)
      : 0,
    opacity: OPACITY_MIN + Math.random() * (OPACITY_MAX - OPACITY_MIN),
    opacityVelocity: animated
      ? OPACITY_SPEED * ANIMATION_SPEED_SCALE * Math.random() * (Math.random() >= 0.5 ? 1 : -1)
      : 0,
    depthScale: depth,
    depthAlpha: depth ** Z_OPACITY_RATE,
  };
}

function createParticles(width: number, height: number, animated: boolean) {
  const count = Math.round((DENSITY_COUNT * width * height) / DENSITY_AREA);
  return Array.from({ length: count }, () => createParticle(width, height, animated));
}

function updateParticles(particles: Particle[], width: number, height: number, factor: number) {
  for (const particle of particles) {
    particle.x += particle.vx * factor;
    particle.y += particle.vy * factor;

    const radius = particle.size;

    if (particle.y + radius < 0) {
      particle.y = height + radius;
      particle.x = Math.random() * width;
    } else if (particle.x + radius < 0) {
      particle.x = width + radius;
      particle.y = Math.random() * height;
    } else if (particle.x - radius > width) {
      particle.x = -radius;
      particle.y = Math.random() * height;
    }

    particle.opacity += particle.opacityVelocity * factor;
    if (particle.opacity >= OPACITY_MAX || particle.opacity <= OPACITY_MIN) {
      particle.opacity = Math.min(Math.max(particle.opacity, OPACITY_MIN), OPACITY_MAX);
      particle.opacityVelocity = -particle.opacityVelocity;
    }

    particle.size += particle.sizeVelocity * factor;
    if (particle.size >= SIZE_MAX || particle.size <= SIZE_MIN) {
      particle.size = Math.min(Math.max(particle.size, SIZE_MIN), SIZE_MAX);
      particle.sizeVelocity = -particle.sizeVelocity;
    }
  }
}

function drawParticles(
  context: CanvasRenderingContext2D,
  particles: Particle[],
  width: number,
  height: number,
) {
  context.clearRect(0, 0, width, height);
  context.fillStyle = COLOR;

  for (const particle of particles) {
    const radius = particle.size * particle.depthScale;

    context.globalAlpha = particle.opacity * particle.depthAlpha;
    context.beginPath();
    context.arc(particle.x, particle.y, radius, 0, TAU);
    context.fill();
  }

  context.globalAlpha = 1;
}

export function BeatSaberParticles() {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");

    if (!wrapper || !canvas || !context) return;

    const animated = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let particles: Particle[] = [];
    let width = 0;
    let height = 0;
    let frame = 0;
    let previousTime = 0;

    const measure = () => {
      width = wrapper.clientWidth;
      height = wrapper.clientHeight;

      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      particles = createParticles(width, height, animated);
      drawParticles(context, particles, width, height);
    };

    const tick = (time: number) => {
      const elapsed = previousTime ? time - previousTime : FRAME_MS;
      previousTime = time;
      updateParticles(particles, width, height, Math.min(elapsed / FRAME_MS, MAX_FRAME_STEP));
      drawParticles(context, particles, width, height);
      frame = requestAnimationFrame(tick);
    };

    measure();
    const readyFrame = requestAnimationFrame(() => setReady(true));
    const observer = new ResizeObserver(measure);
    observer.observe(wrapper);

    if (animated) frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(readyFrame);
      observer.disconnect();
    };
  }, []);

  return (
    <div
      ref={wrapperRef}
      className={`beat-saber-particles${ready ? " beat-saber-particles-ready" : ""}`}
    >
      <canvas ref={canvasRef} aria-hidden="true" />
    </div>
  );
}
