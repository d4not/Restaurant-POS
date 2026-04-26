// Single-source-of-truth icons. SVG only — sized in `em` so they scale with
// surrounding font-size, and `currentColor` so the parent button drives colour.
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

export const IconGrid: Icon = (props) => (
  <svg {...base} {...props}>
    <rect x="3" y="3" width="7" height="7" rx="1.5" />
    <rect x="14" y="3" width="7" height="7" rx="1.5" />
    <rect x="3" y="14" width="7" height="7" rx="1.5" />
    <rect x="14" y="14" width="7" height="7" rx="1.5" />
  </svg>
);

export const IconList: Icon = (props) => (
  <svg {...base} {...props}>
    <line x1="8" y1="6" x2="21" y2="6" />
    <line x1="8" y1="12" x2="21" y2="12" />
    <line x1="8" y1="18" x2="21" y2="18" />
    <circle cx="4" cy="6" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="4" cy="12" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="4" cy="18" r="1.4" fill="currentColor" stroke="none" />
  </svg>
);

export const IconClock: Icon = (props) => (
  <svg {...base} {...props}>
    <circle cx="12" cy="12" r="9" />
    <polyline points="12 7 12 12 15.5 14" />
  </svg>
);

export const IconPlus: Icon = (props) => (
  <svg {...base} {...props}>
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

export const IconMenu: Icon = (props) => (
  <svg {...base} {...props}>
    <line x1="4" y1="7" x2="20" y2="7" />
    <line x1="4" y1="12" x2="20" y2="12" />
    <line x1="4" y1="17" x2="20" y2="17" />
  </svg>
);

export const IconBell: Icon = (props) => (
  <svg {...base} {...props}>
    <path d="M6 8a6 6 0 1 1 12 0c0 4 1.5 6 1.5 6h-15S6 12 6 8Z" />
    <path d="M10 19a2 2 0 0 0 4 0" />
  </svg>
);

export const IconLock: Icon = (props) => (
  <svg {...base} {...props}>
    <rect x="4" y="11" width="16" height="10" rx="2" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </svg>
);

export const IconSettings: Icon = (props) => (
  <svg {...base} {...props}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
  </svg>
);

export const IconSignOut: Icon = (props) => (
  <svg {...base} {...props}>
    <path d="M9 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4" />
    <polyline points="16 17 21 12 16 7" />
    <line x1="21" y1="12" x2="9" y2="12" />
  </svg>
);

export const IconBackspace: Icon = (props) => (
  <svg {...base} {...props}>
    <path d="M21 5H10l-7 7 7 7h11a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1Z" />
    <line x1="14" y1="9" x2="19" y2="14" />
    <line x1="19" y1="9" x2="14" y2="14" />
  </svg>
);

export const IconPrinter: Icon = (props) => (
  <svg {...base} {...props}>
    <path d="M7 9V3h10v6" />
    <rect x="3" y="9" width="18" height="9" rx="2" />
    <rect x="7" y="14" width="10" height="7" rx="1" />
    <circle cx="17.5" cy="12.5" r="0.8" fill="currentColor" stroke="none" />
  </svg>
);

export const IconClose: Icon = (props) => (
  <svg {...base} {...props}>
    <line x1="6" y1="6" x2="18" y2="18" />
    <line x1="18" y1="6" x2="6" y2="18" />
  </svg>
);

export const IconCash: Icon = (props) => (
  <svg {...base} {...props}>
    <rect x="2.5" y="6" width="19" height="12" rx="2" />
    <circle cx="12" cy="12" r="2.6" />
    <line x1="6" y1="9.5" x2="6" y2="14.5" />
    <line x1="18" y1="9.5" x2="18" y2="14.5" />
  </svg>
);

export const IconPercent: Icon = (props) => (
  <svg {...base} {...props}>
    <line x1="19" y1="5" x2="5" y2="19" />
    <circle cx="7" cy="7" r="2.2" />
    <circle cx="17" cy="17" r="2.2" />
  </svg>
);

export const IconCheck: Icon = (props) => (
  <svg {...base} {...props}>
    <polyline points="5 12 10 17 19 7" />
  </svg>
);

export const IconShield: Icon = (props) => (
  <svg {...base} {...props}>
    <path d="M12 3 4.5 6v6c0 4.4 3.2 7.8 7.5 9 4.3-1.2 7.5-4.6 7.5-9V6L12 3Z" />
    <polyline points="9 12 11 14 15 10" />
  </svg>
);
