// Admin-mode-specific icons. Same base attrs as the rest of the terminal so
// they inherit color and scale with font-size. These cover the report tiles
// that don't have a counterpart in components/Icons.tsx or HubIcons.tsx.

import type { ReactElement, SVGProps } from 'react';

type Icon = (props: SVGProps<SVGSVGElement>) => ReactElement;

const base: SVGProps<SVGSVGElement> = {
  width: '1em',
  height: '1em',
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
};

export const IconTrendUp: Icon = (props) => (
  <svg {...base} {...props}>
    <polyline points="3 17 9 11 13 15 21 7" />
    <polyline points="15 7 21 7 21 13" />
  </svg>
);

export const IconRanking: Icon = (props) => (
  <svg {...base} {...props}>
    <rect x="4" y="13" width="4" height="7" rx="1" />
    <rect x="10" y="9" width="4" height="11" rx="1" />
    <rect x="16" y="5" width="4" height="15" rx="1" />
  </svg>
);

export const IconCoins: Icon = (props) => (
  <svg {...base} {...props}>
    <ellipse cx="9" cy="8" rx="6" ry="2.5" />
    <path d="M3 8v4c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5V8" />
    <path d="M3 12v4c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5v-4" />
    <ellipse cx="17.5" cy="14" rx="3.5" ry="1.6" />
    <path d="M14 14v4c0 .9 1.6 1.6 3.5 1.6s3.5-.7 3.5-1.6v-4" />
  </svg>
);

export const IconRecipe: Icon = (props) => (
  <svg {...base} {...props}>
    <path d="M6 4h10a2 2 0 0 1 2 2v14H8a2 2 0 0 1-2-2V4Z" />
    <path d="M6 4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2" />
    <line x1="10" y1="9" x2="15" y2="9" />
    <line x1="10" y1="13" x2="15" y2="13" />
    <line x1="10" y1="17" x2="13" y2="17" />
  </svg>
);

export const IconBox: Icon = (props) => (
  <svg {...base} {...props}>
    <path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5v-9Z" />
    <polyline points="3 7.5 12 12 21 7.5" />
    <line x1="12" y1="12" x2="12" y2="21" />
  </svg>
);

export const IconSearch: Icon = (props) => (
  <svg {...base} {...props}>
    <circle cx="11" cy="11" r="6.5" />
    <line x1="20.5" y1="20.5" x2="16" y2="16" />
  </svg>
);

export const IconArrowReturn: Icon = (props) => (
  <svg {...base} {...props}>
    <polyline points="9 6 4 11 9 16" />
    <path d="M4 11h11a5 5 0 0 1 5 5v2" />
  </svg>
);

export const IconQuestion: Icon = (props) => (
  <svg {...base} {...props}>
    <circle cx="12" cy="12" r="9" />
    <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6" />
    <circle cx="12" cy="17" r="0.8" fill="currentColor" stroke="none" />
  </svg>
);

export const IconSparkle: Icon = (props) => (
  <svg {...base} {...props}>
    <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6" />
  </svg>
);

export const IconUsers: Icon = (props) => (
  <svg {...base} {...props}>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M3 20c0-3 2.7-5.5 6-5.5s6 2.5 6 5.5" />
    <circle cx="17" cy="9" r="2.8" />
    <path d="M21 19c0-2.4-1.9-4.3-4-4.3" />
  </svg>
);

export const IconCalendarCheck: Icon = (props) => (
  <svg {...base} {...props}>
    <rect x="3.5" y="5" width="17" height="15" rx="2" />
    <path d="M3.5 10h17" />
    <path d="M8 3v4M16 3v4" />
    <polyline points="9 14 11.5 16.5 16 12.5" />
  </svg>
);

export const IconWallet: Icon = (props) => (
  <svg {...base} {...props}>
    <path d="M4 7a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v2H6a2 2 0 0 0 0 4h13v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7Z" />
    <circle cx="16" cy="11" r="1.2" fill="currentColor" stroke="none" />
  </svg>
);

export const IconPlusCircle: Icon = (props) => (
  <svg {...base} {...props}>
    <circle cx="12" cy="12" r="9" />
    <line x1="12" y1="8" x2="12" y2="16" />
    <line x1="8" y1="12" x2="16" y2="12" />
  </svg>
);

export const IconClipboard: Icon = (props) => (
  <svg {...base} {...props}>
    <rect x="6" y="4.5" width="12" height="16" rx="2" />
    <path d="M9 4.5v-.5a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 4v.5" />
    <line x1="9" y1="11" x2="15" y2="11" />
    <line x1="9" y1="14.5" x2="14" y2="14.5" />
  </svg>
);

export const IconTruck: Icon = (props) => (
  <svg {...base} {...props}>
    <path d="M3 7h11v9H3z" />
    <path d="M14 10h4l3 3v3h-7z" />
    <circle cx="7" cy="18" r="1.8" />
    <circle cx="17" cy="18" r="1.8" />
  </svg>
);

export const IconScale: Icon = (props) => (
  <svg {...base} {...props}>
    <path d="M12 4v16" />
    <path d="M6 20h12" />
    <path d="M4 8h16" />
    <path d="M8 8 4.5 14.5a3.5 3.5 0 0 0 7 0L8 8Z" />
    <path d="M16 8l-3.5 6.5a3.5 3.5 0 0 0 7 0L16 8Z" />
  </svg>
);

export const IconDrop: Icon = (props) => (
  <svg {...base} {...props}>
    <path d="M12 3.5c4 5 6 8.5 6 11a6 6 0 0 1-12 0c0-2.5 2-6 6-11Z" />
    <path d="M9 14c0 1.7 1.3 3 3 3" />
  </svg>
);

export const IconList: Icon = (props) => (
  <svg {...base} {...props}>
    <line x1="9" y1="6" x2="20" y2="6" />
    <line x1="9" y1="12" x2="20" y2="12" />
    <line x1="9" y1="18" x2="20" y2="18" />
    <circle cx="5" cy="6" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="5" cy="12" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="5" cy="18" r="1.2" fill="currentColor" stroke="none" />
  </svg>
);

export const IconTag: Icon = (props) => (
  <svg {...base} {...props}>
    <path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9-9-9Z" />
    <circle cx="8" cy="8" r="1.6" fill="currentColor" stroke="none" />
  </svg>
);

export const IconSliders: Icon = (props) => (
  <svg {...base} {...props}>
    <line x1="4" y1="6" x2="20" y2="6" />
    <line x1="4" y1="12" x2="20" y2="12" />
    <line x1="4" y1="18" x2="20" y2="18" />
    <circle cx="9" cy="6" r="2" fill="var(--bg2)" />
    <circle cx="15" cy="12" r="2" fill="var(--bg2)" />
    <circle cx="9" cy="18" r="2" fill="var(--bg2)" />
  </svg>
);

export const IconFolder: Icon = (props) => (
  <svg {...base} {...props}>
    <path d="M3 6a1 1 0 0 1 1-1h5l2 2h8a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6Z" />
  </svg>
);

export const IconBadge: Icon = (props) => (
  <svg {...base} {...props}>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="M9 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" />
    <path d="M5 17c0-2 1.8-3 4-3s4 1 4 3" />
    <line x1="15" y1="8" x2="19" y2="8" />
    <line x1="15" y1="12" x2="19" y2="12" />
  </svg>
);
