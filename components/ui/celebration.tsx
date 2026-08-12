"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { categoricalColor } from "@/components/charts/palette";

/**
 * Confetti and a congratulation, for a daily completion milestone.
 *
 * Written rather than pulled in: a confetti dependency is a few hundred KB on
 * every page load for something that fires at most three times a day, and none
 * of them honour reduced motion by default.
 *
 * Rendered through a portal to `document.body` — table rows carry a hover
 * `filter`, which creates a containing block and would trap a `position: fixed`
 * overlay inside the row that triggered it. The same trap the notes dialog hit.
 */

interface Piece {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rotation: number;
  spin: number;
  width: number;
  height: number;
  color: string;
}

const PIECE_COUNT = 140;
const GRAVITY = 0.12;
const DRAG = 0.995;
const VISIBLE_MS = 5200;

function makePieces(width: number, dark: boolean): Piece[] {
  const pieces: Piece[] = [];
  for (let i = 0; i < PIECE_COUNT; i++) {
    pieces.push({
      x: Math.random() * width,
      // Staggered above the fold so they arrive as a shower, not a curtain.
      y: -Math.random() * 400 - 20,
      vx: (Math.random() - 0.5) * 3,
      vy: Math.random() * 2 + 1.5,
      rotation: Math.random() * Math.PI * 2,
      spin: (Math.random() - 0.5) * 0.25,
      width: Math.random() * 6 + 5,
      height: Math.random() * 4 + 4,
      color: categoricalColor(i % 6, dark),
    });
  }
  return pieces;
}

function Confetti({ dark }: { dark: boolean }) {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const context = canvas.getContext("2d");
    if (!context) return;

    const ratio = window.devicePixelRatio || 1;
    const width = window.innerWidth;
    const height = window.innerHeight;
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    context.scale(ratio, ratio);

    let pieces = makePieces(width, dark);
    let frame = 0;

    const draw = () => {
      context.clearRect(0, 0, width, height);

      for (const piece of pieces) {
        piece.vy += GRAVITY;
        piece.vx *= DRAG;
        piece.x += piece.vx;
        piece.y += piece.vy;
        piece.rotation += piece.spin;

        context.save();
        context.translate(piece.x, piece.y);
        context.rotate(piece.rotation);
        context.fillStyle = piece.color;
        // Scaling the height by the rotation fakes a flutter without needing
        // a third axis — the strip appears to turn edge-on and back.
        context.fillRect(
          -piece.width / 2,
          -piece.height / 2,
          piece.width,
          piece.height * Math.abs(Math.cos(piece.rotation)),
        );
        context.restore();
      }

      pieces = pieces.filter((piece) => piece.y < height + 40);
      if (pieces.length > 0) frame = requestAnimationFrame(draw);
    };

    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [dark]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none fixed inset-0 z-[200]"
      style={{ width: "100vw", height: "100vh" }}
    />
  );
}

export function Celebration({
  message,
  dark,
  onDone,
}: {
  message: string;
  dark: boolean;
  onDone: () => void;
}) {
  const [mounted, setMounted] = React.useState(false);

  // Someone who has asked their system to reduce motion still gets the news,
  // just without a hundred and forty things flying at them.
  const reducedMotion =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  React.useEffect(() => setMounted(true), []);

  React.useEffect(() => {
    const timer = setTimeout(onDone, VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [onDone]);

  if (!mounted) return null;

  return createPortal(
    <>
      {reducedMotion ? null : <Confetti dark={dark} />}

      <div
        // Assertive rather than polite: this interrupts by design, and a
        // milestone announced after whatever else is queued has lost its point.
        role="status"
        aria-live="assertive"
        className="pointer-events-none fixed inset-x-0 top-24 z-[201] flex justify-center px-4"
      >
        <div
          className="pointer-events-auto max-w-lg rounded-xl border px-5 py-4 text-center shadow-2xl"
          style={{
            background: "var(--surface-raised)",
            borderColor: "var(--live)",
            color: "var(--ink)",
          }}
        >
          <p className="text-[15px] font-semibold leading-snug">{message}</p>
          <button
            type="button"
            onClick={onDone}
            className="mt-2 rounded-md border px-2.5 py-1 text-[11.5px] font-medium transition"
            style={{ borderColor: "var(--line-strong)", color: "var(--ink-muted)" }}
          >
            Dismiss
          </button>
        </div>
      </div>
    </>,
    document.body,
  );
}
