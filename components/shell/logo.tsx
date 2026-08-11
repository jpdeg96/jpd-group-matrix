import { cn } from "@/lib/ui/cn";

/**
 * The JPD Group logo.
 *
 * Purely presentational and safe in both server and client components — the
 * `src` is resolved on the server by `resolveLogoSrc()` and handed in, so a
 * missing PNG never produces a 404 in the browser console.
 *
 * Sizing is height-driven with `width: auto` and `object-contain`, so any
 * aspect ratio or pixel size fits without distortion. A wide wordmark and a
 * square mark both work; the image is never stretched.
 *
 * To change the logo, drop `public/jpd-logo.png` in. PNG, JPG and WebP all take
 * precedence over the built-in SVG placeholder. No code change needed.
 */
export function Logo({
  src,
  height = 26,
  className,
  alt = "JPD Group",
}: {
  src: string;
  height?: number;
  className?: string;
  alt?: string;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a static logo of
    // unknown intrinsic size; next/image would need width/height up front.
    <img
      src={src}
      alt={alt}
      style={{ height, width: "auto", maxWidth: "100%" }}
      className={cn("object-contain", className)}
    />
  );
}
