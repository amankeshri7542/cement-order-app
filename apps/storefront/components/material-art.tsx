export function MaterialArt({ large = false }: { large?: boolean }) {
  return (
    <svg
      className={large ? 'material-art material-art-large' : 'material-art'}
      viewBox="0 0 320 220"
      fill="none"
      aria-hidden="true"
    >
      <path className="art-ground" d="M18 184H302M47 202H273" />
      <g className="art-block">
        <path d="m172 146 61-26 60 25-60 28-61-27Z" />
        <path d="M172 146v34l61 27 60-28v-34M233 173v34M190 139l61 27M213 130l59 27M191 155l59-26M212 164l60-26" />
      </g>
      <g className="art-bag">
        <path d="m56 48 81-11 24 26 6 103-85 15-31-23 5-110Z" />
        <path d="m56 48 24 21 81-6M80 69l2 112M56 48l78-10M55 145l27 24 84-15" />
        <path d="m91 86 55-7 1 51-55 9-1-53Z" />
        <path d="m105 98 28-4M107 108l25-4M108 121l26-4" />
      </g>
      <g className="art-rods">
        <path d="m186 48 10-3 66 68-10 6-66-71Zm15-10 10-3 66 68-9 5-67-70Zm15-10 10-3 66 68-9 5-67-70Z" />
        <path d="m197 53 7-5m6 19 8-5m5 19 8-5m6 19 7-5m-21-45 7-4m6 18 8-5m6 19 7-5m-17-35 7-4m6 18 7-5m6 19 8-5" />
      </g>
    </svg>
  );
}
