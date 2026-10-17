// Flat drawings of the material type, coloured from the theme's material tokens in globals.css
// (.ma-kraft, .ma-steel ...). They stand in for the family's own photographs, which replace them.
export function MaterialArt({
  large = false,
  category = '',
}: {
  large?: boolean;
  category?: string;
}) {
  const kind = /steel|tmt|rod|metal|सरिया/i.test(category)
    ? 'steel'
    : /brick|block|ईंट/i.test(category)
      ? 'brick'
      : /aggregate|stone|chip|गिट्टी/i.test(category)
        ? 'stone'
        : /sand|रेत|बालू/i.test(category)
          ? 'sand'
          : /tile|adhesive|paint|chemical|pipe|hardware/i.test(category)
            ? 'finish'
            : 'cement';
  return (
    <svg
      className={`material-art material-${kind}${large ? ' material-art-large' : ''}`}
      viewBox="0 0 320 240"
      fill="none"
      aria-hidden="true"
    >
      <g transform="translate(76 36) scale(3.5)">
        {kind === 'cement' ? (
          <>
            <path className="ma-kraft" d="M10 9h28l3 32H7z" />
            <rect className="ma-ink" x="11" y="19" width="26" height="11" />
            <rect className="ma-paper" x="14" y="22" width="12" height="2.4" />
            <rect className="ma-paper" x="14" y="26" width="8" height="2" />
            <path className="ma-kraft-line" d="M10 9l4-5h20l4 5" strokeWidth="3" />
          </>
        ) : kind === 'steel' ? (
          <>
            {[12, 21.5, 31].map((y) => (
              <rect key={y} className="ma-steel" x="4" y={y} width="40" height="5" rx="2.5" />
            ))}
            {[12, 21.5, 31].map((y, row) =>
              [0, 1, 2, 3].map((n) => (
                <rect
                  key={`${y}-${n}`}
                  className="ma-rib"
                  x={(row % 2 ? 14 : 10) + n * 8}
                  y={y}
                  width="2"
                  height="5"
                />
              )),
            )}
          </>
        ) : kind === 'brick' ? (
          <>
            <path className="ma-brick" d="M6 18l18-7 18 7v14l-18 7-18-7z" />
            <path className="ma-brick-line" d="M6 18l18 7 18-7" strokeWidth="1.5" />
            <path className="ma-shade" d="M17 17.5l7-2.7 7 2.7-7 2.7z" />
          </>
        ) : kind === 'sand' ? (
          <>
            <path className="ma-sand" d="M3 40c6-15 13-24 21-24s15 9 21 24z" />
            {[
              [18, 30, 1.3],
              [26, 26, 1.1],
              [31, 33, 1.3],
              [22, 36, 1],
            ].map(([cx, cy, r]) => (
              <circle key={`${cx}-${cy}`} className="ma-grain" cx={cx} cy={cy} r={r} />
            ))}
          </>
        ) : kind === 'stone' ? (
          <>
            <path className="ma-stone" d="M6 36l6-9 8 2 2 8z" />
            <path className="ma-stone" d="M18 38l5-12 10 1 3 11z" />
            <path className="ma-stone" d="M30 36l4-8 8 3 1 6z" />
            <path className="ma-stone ma-soft" d="M13 26l5-8 8 3-2 7z" />
          </>
        ) : (
          <>
            <rect className="ma-stone" x="7" y="9" width="16" height="14" />
            <rect className="ma-kraft" x="25" y="9" width="16" height="14" />
            <rect className="ma-kraft" x="7" y="25" width="16" height="14" />
            <rect className="ma-stone" x="25" y="25" width="16" height="14" />
          </>
        )}
      </g>
    </svg>
  );
}
