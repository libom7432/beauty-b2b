type ProductVisualProps = { kind: "nails" | "lashes"; className?: string };

function NailArtwork() {
  const colors = ["#a56c66", "#c78e88", "#e4b3a8", "#8d514e", "#c39c96", "#b4776e", "#e5b9af", "#9f5f59", "#cf9990", "#b98780"];
  return (
    <svg viewBox="0 0 520 620" role="presentation" focusable="false" className="product-artwork" preserveAspectRatio="xMidYMid meet">
      <rect width="520" height="620" fill="#eae1dc" />
      <circle cx="419" cy="107" r="168" fill="#f0e9e5" />
      <g transform="translate(73 73) rotate(-5 185 230)">
        <rect x="9" y="14" width="370" height="475" fill="#bbaaa3" opacity=".22" />
        <rect width="370" height="475" fill="#f8f4ef" />
        <text x="31" y="47" fontSize="12" letterSpacing="4" fill="#5f514d" fontFamily="Arial, sans-serif">BRAND / EDITION</text>
        <line x1="31" y1="65" x2="339" y2="65" stroke="#d8cbc3" />
        {colors.map((color, index) => {
          const x = 30 + (index % 5) * 63;
          const y = 94 + Math.floor(index / 5) * 159;
          return (
            <g key={index} transform={`translate(${x} ${y})`}>
              <path d="M 0 23 C 0 9 9 0 26 0 C 43 0 52 9 52 23 L 52 112 C 52 128 42 137 26 137 C 10 137 0 128 0 112 Z" fill="#8c6963" opacity=".18" transform="translate(2 5)" />
              <path d="M 0 23 C 0 9 9 0 26 0 C 43 0 52 9 52 23 L 52 112 C 52 128 42 137 26 137 C 10 137 0 128 0 112 Z" fill={color} />
              <path d="M 9 23 C 9 13 16 8 25 8" fill="none" stroke="#fff" strokeOpacity=".42" strokeWidth="3" />
            </g>
          );
        })}
        <line x1="31" y1="432" x2="339" y2="432" stroke="#d8cbc3" />
        <text x="31" y="454" fontSize="10" letterSpacing="3" fill="#84746e" fontFamily="Arial, sans-serif">PRESS-ON NAILS</text>
      </g>
    </svg>
  );
}

function LashArtwork() {
  const hairs = Array.from({ length: 27 }, (_, index) => index);
  return (
    <svg viewBox="0 0 520 620" role="presentation" focusable="false" className="product-artwork" preserveAspectRatio="xMidYMid meet">
      <rect width="520" height="620" fill="#d7c9c3" />
      <circle cx="93" cy="494" r="192" fill="#dfd3cd" />
      <g transform="translate(64 74) rotate(5 195 230)">
        <rect x="9" y="14" width="390" height="478" fill="#78665f" opacity=".2" />
        <rect width="390" height="478" fill="#f5eee8" />
        <text x="31" y="48" fontSize="12" letterSpacing="4" fill="#5f514d" fontFamily="Arial, sans-serif">BRAND / EDITION</text>
        <line x1="31" y1="66" x2="359" y2="66" stroke="#d1c1b9" />
        <rect x="31" y="87" width="328" height="314" fill="#e9dcd5" />
        {[0, 1].map((row) => {
          const base = 224 + row * 121;
          return (
            <g key={row}>
              <path d={`M 59 ${base} Q 195 ${base + 52} 331 ${base}`} fill="none" stroke="#302825" strokeWidth="5" strokeLinecap="round" />
              {hairs.map((index) => {
                const x = 65 + index * 10;
                const rise = 20 + Math.sin((index / 26) * Math.PI) * 29;
                const y = base + Math.sin((index / 26) * Math.PI) * 26;
                return <path key={index} d={`M ${x} ${y} Q ${x - 6} ${y - rise * .65} ${x - 12} ${y - rise}`} fill="none" stroke="#332b28" strokeWidth="2" strokeLinecap="round" />;
              })}
            </g>
          );
        })}
        <line x1="31" y1="431" x2="359" y2="431" stroke="#d1c1b9" />
        <text x="31" y="454" fontSize="10" letterSpacing="3" fill="#84746e" fontFamily="Arial, sans-serif">FALSE EYELASHES</text>
      </g>
    </svg>
  );
}

export function ProductVisual({ kind, className = "" }: ProductVisualProps) {
  return <div className={`product-visual ${className}`} aria-hidden="true">{kind === "nails" ? <NailArtwork /> : <LashArtwork />}</div>;
}
