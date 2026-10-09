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
      : /sand|aggregate|stone|रेत|गिट्टी/i.test(category)
        ? 'sand'
        : /tile|adhesive|paint|chemical/i.test(category)
          ? 'finish'
          : 'cement';
  return (
    <svg
      className={`material-art material-${kind}${large ? ' material-art-large' : ''}`}
      viewBox="0 0 320 240"
      fill="none"
      aria-hidden="true"
    >
      <ellipse cx="162" cy="205" rx="112" ry="13" fill="#173345" opacity=".08" />
      {kind === 'cement' ? (
        <g transform="rotate(-8 160 120)">
          <path
            d="M100 32 215 36 228 199Q169 215 96 192Z"
            fill="#DDD5BA"
            stroke="#B5AD92"
            strokeWidth="2"
          />
          <path d="m101 32 5 15 108 4M98 187l127 6" stroke="#B5AD92" strokeWidth="3" />
          <path d="m100 82 118 5 6 76-127-9Z" fill="#173345" />
          <path d="m118 105 83 5m-84 12 62 5m-63 12 76 5" stroke="#F5F3ED" strokeWidth="6" />
          <path d="m110 57 28 2m50 3 17 1" stroke="#B5AD92" strokeWidth="4" />
        </g>
      ) : kind === 'brick' ? (
        <g>
          <path d="m55 110 123-49 95 42-126 54Z" fill="#CC7653" />
          <path d="M55 110v68l92 40v-61Z" fill="#B45438" />
          <path d="m147 157 126-54v68l-126 47Z" fill="#8D422E" />
          {[0, 1, 2].map((i) => (
            <path key={i} d={`m${82 + i * 35} ${107 - i * 14} 19-8 47 20-20 9Z`} fill="#753B2D" />
          ))}
          <path d="M69 148v20l59 25v-20Z" fill="#A14A31" />
        </g>
      ) : kind === 'steel' ? (
        <g transform="rotate(-24 160 120)">
          {[0, 1, 2, 3, 4].map((i) => (
            <g key={i}>
              <path d={`M42 ${72 + i * 24}h240v14H42Z`} fill={i % 2 ? '#697D87' : '#3A5666'} />
              <ellipse cx="42" cy={79 + i * 24} rx="8" ry="7" fill="#A1AFB4" />
              {[0, 1, 2, 3, 4, 5, 6].map((n) => (
                <path
                  key={n}
                  d={`m${68 + n * 30} ${72 + i * 24} 7 14`}
                  stroke="#A1AFB4"
                  strokeWidth="3"
                />
              ))}
            </g>
          ))}
        </g>
      ) : kind === 'sand' ? (
        <g>
          <path
            d="M35 191q48-51 74-65 11-58 51-77 40 38 53 76 42 14 76 66Q160 229 35 191"
            fill="#CEBE99"
          />
          <path d="m160 49-33 130 58-76" fill="#E5D8B8" />
          <path d="m213 125-43 75 119-9" fill="#AA9A76" />
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <circle key={i} cx={76 + i * 29} cy={180 + (i % 2) * 13} r="3" fill="#897C60" />
          ))}
        </g>
      ) : (
        <g>
          <path d="m72 64 112-27 77 70-113 31Z" fill="#D9E0DB" />
          <path d="m72 64 76 74v72l-76-70Z" fill="#9CAFAD" />
          <path d="m148 138 113-31v72l-113 31Z" fill="#BCCBC5" />
          <path
            d="m98 86 111-28M126 111l111-27M113 53l77 74M150 44l75 73"
            stroke="#FFF"
            strokeWidth="3"
          />
          <path d="m170 161 66-17" stroke="#173345" strokeWidth="7" />
        </g>
      )}
    </svg>
  );
}
