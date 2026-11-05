import { plates } from '../art';
import type { Material } from '../lib/materials';

// Sizes written here, because the dev bundler cannot read an AVIF's size from its import.
const art = {
  cement: { src: plates['sp-cement'].src, width: 1000, height: 800 },
  sariya: { src: plates['sp-sariya'].src, width: 1400, height: 860 },
  bricks: { src: plates['sp-bricks'].src, width: 800, height: 680 },
  balu: { src: plates['sp-balu'].src, width: 800, height: 600 },
  gitti: { src: plates['sp-gitti'].src, width: 800, height: 600 },
} as const;
/** A drawing of the material, not a photograph of it. Decorative: the name is always beside it. */
export function Specimen({
  kind,
  className,
  sizes,
  first = false,
}: {
  kind: NonNullable<Material['specimen']>;
  className?: string;
  sizes?: string;
  /** At the top of its page, where it is what a visitor waits to see. */
  first?: boolean;
}) {
  const plate = art[kind];
  return (
    // Baked plates are already the right size: no image route, no extra request.
    <img
      className={className}
      src={plate.src}
      width={plate.width}
      height={plate.height}
      alt=""
      loading={first ? 'eager' : 'lazy'}
      fetchPriority={first ? 'high' : undefined}
      decoding="async"
      sizes={sizes}
    />
  );
}
