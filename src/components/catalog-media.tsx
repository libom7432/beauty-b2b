import Image from "next/image";
import type { ProductImage, VisualKind } from "@/lib/catalog/types";

type Props = { visual: VisualKind; image?: Pick<ProductImage, "src"> & { position?: string }; alt?: string; className?: string; sizes?: string };

function MockArtwork({ visual }: { visual: VisualKind }) {
  const colors: Record<VisualKind, string> = {
    "press-on": "#d8bbb0", gel: "#d5b9b2", lamp: "#d8d3ca",
    machine: "#c9c8c4", tools: "#d5cec4", accessories: "#dbc9bf",
  };
  return (
    <svg viewBox="0 0 560 640" className="catalog-artwork" role="presentation" focusable="false" preserveAspectRatio="xMidYMid slice">
      <rect width="560" height="640" fill={colors[visual]} />
      <circle cx="465" cy="95" r="230" fill="#f7f1eb" opacity=".26" />
      {visual === "press-on" && (
        <g transform="translate(105 75) rotate(-6 175 240)">
          <rect x="12" y="16" width="350" height="485" fill="#67473b" opacity=".13" />
          <rect width="350" height="485" fill="#f8f3ed" />
          <text x="28" y="48" fontSize="12" letterSpacing="4" fill="#695650" fontFamily="Arial, sans-serif">BRAND / NAIL STUDIO</text>
          <line x1="28" y1="64" x2="322" y2="64" stroke="#d7c8bd" />
          {Array.from({ length: 10 }, (_, i) => {
            const x = 28 + (i % 5) * 60;
            const y = 96 + Math.floor(i / 5) * 163;
            return <path key={i} transform={`translate(${x} ${y})`} d="M 0 23 C 0 8 9 0 24 0 C 39 0 48 8 48 23 L 48 111 C 48 126 39 137 24 137 C 9 137 0 126 0 111 Z" fill={["#a66d66", "#c99187", "#dfb5a6", "#925d59", "#b9877c"][i % 5]} />;
          })}
          <text x="28" y="455" fontSize="10" letterSpacing="3" fill="#887a72" fontFamily="Arial, sans-serif">PRESS-ON NAILS</text>
        </g>
      )}
      {visual === "gel" && (
        <g>
          {[145, 285, 425].map((x, i) => <g key={x} transform={`translate(${x - 57} ${210 + (i % 2) * 24})`}>
            <rect x="13" y="0" width="88" height="78" fill="#2b2624" />
            <rect x="0" y="74" width="114" height="198" rx="9" fill={["#af8278", "#c99d96", "#9d6e6a"][i]} />
            <rect x="12" y="123" width="90" height="83" fill="#f7f0e8" />
            <text x="23" y="159" fontSize="10" letterSpacing="2" fill="#6a534b" fontFamily="Arial, sans-serif">BRAND</text>
          </g>)}</g>
      )}
      {visual === "lamp" && <g><ellipse cx="282" cy="497" rx="213" ry="40" fill="#655e56" opacity=".16" /><path d="M 93 425 C 108 274 170 202 281 202 C 396 202 461 282 470 425 Q 468 485 282 489 Q 98 484 93 425 Z" fill="#f1eee8" /><path d="M 142 425 Q 282 369 421 425" fill="none" stroke="#c4bdb4" strokeWidth="13" /><rect x="252" y="225" width="62" height="6" rx="3" fill="#aaa39a" /></g>}
      {visual === "machine" && <g transform="rotate(-25 280 320)"><ellipse cx="275" cy="490" rx="190" ry="36" fill="#4c4947" opacity=".13" /><rect x="202" y="89" width="146" height="410" rx="68" fill="#eeeae4" /><rect x="202" y="124" width="146" height="64" fill="#a9978d" /><rect x="225" y="235" width="100" height="8" rx="4" fill="#bfb5ac" /><path d="M 275 90 L 275 29" stroke="#9b9995" strokeWidth="17" /></g>}
      {visual === "tools" && <g strokeLinecap="round"><path d="M 173 486 L 320 125" stroke="#eee9e2" strokeWidth="24" /><path d="M 290 502 L 421 151" stroke="#b0a49a" strokeWidth="17" /><path d="M 323 125 L 344 78" stroke="#817a72" strokeWidth="10" /><path d="M 421 151 L 440 105" stroke="#817a72" strokeWidth="8" /><circle cx="172" cy="486" r="15" fill="#f5efe9" /></g>}
      {visual === "accessories" && <g fill="#f7ede6" stroke="#ad8175" strokeWidth="2">{[[159, 203, 27], [335, 160, 36], [258, 335, 44], [433, 397, 24], [120, 452, 31]].map(([x, y, r], i) => <circle key={i} cx={x} cy={y} r={r} />)}<path d="M 285 88 l13 35 35 13 -35 13 -13 35 -13 -35 -35 -13 35 -13 Z" /><path d="M 392 260 l10 27 27 10 -27 10 -10 27 -10 -27 -27 -10 27 -10 Z" /></g>}
      <text x="34" y="608" fontSize="11" letterSpacing="4" fill="#5a4c46" fontFamily="Arial, sans-serif">PRODUCT DIRECTION / BRAND</text>
    </svg>
  );
}

export function CatalogMedia({ visual, image, alt = "", className = "", sizes = "(max-width: 768px) 100vw, 50vw" }: Props) {
  return (
    <div className={`catalog-media ${className}`}>
      {image?.src ? <Image src={image.src} alt={alt} fill sizes={sizes} className="object-cover" style={{ objectPosition: image.position }} /> : <MockArtwork visual={visual} />}
    </div>
  );
}
