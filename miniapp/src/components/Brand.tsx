/** Geometric bear head: two ears, a broad head, a muzzle and a soft nose. */
export function BearMark({ size = 40 }: { size?: number }) {
  return (
    <svg className="bear-mark" width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <defs>
        <radialGradient id="bm-coin" cx="35%" cy="25%" r="85%">
          <stop offset="0" stopColor="#6A3A22" />
          <stop offset=".55" stopColor="#3E2416" />
          <stop offset="1" stopColor="#21140C" />
        </radialGradient>
        <linearGradient id="bm-honey" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#F0C57C" />
          <stop offset="1" stopColor="#C88A36" />
        </linearGradient>
      </defs>
      <circle cx="24" cy="24" r="23" fill="url(#bm-coin)" />
      <circle cx="24" cy="24" r="22.25" fill="none" stroke="#D9A04A" strokeOpacity=".55" strokeWidth="1" />
      <g fill="url(#bm-honey)">
        <circle cx="14.6" cy="15.6" r="5.2" />
        <circle cx="33.4" cy="15.6" r="5.2" />
        <ellipse cx="24" cy="26.4" rx="12.6" ry="11.2" />
      </g>
      <g fill="#2A1810">
        <circle cx="14.6" cy="15.6" r="2.3" />
        <circle cx="33.4" cy="15.6" r="2.3" />
        <circle cx="19" cy="23.6" r="1.45" />
        <circle cx="29" cy="23.6" r="1.45" />
        <ellipse cx="24" cy="31" rx="5.6" ry="4.4" fillOpacity=".9" />
      </g>
      <path d="M21.6 28.3h4.8a.9.9 0 0 1 .7 1.5l-2.4 2.6a.9.9 0 0 1-1.4 0l-2.4-2.6a.9.9 0 0 1 .7-1.5z" fill="#F0C57C" />
    </svg>
  );
}

export function Wordmark() {
  return (
    <span className="wordmark" aria-label="BEAR PLANNER">
      <span className="wm-bear">BEAR</span>
      <span className="wm-planner">PLANNER</span>
    </span>
  );
}
