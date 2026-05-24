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

export const IconRegister: Icon = (props) => (
  <svg {...base} {...props}>
    <rect x="3" y="6" width="18" height="14" rx="2" />
    <path d="M7 6V4h10v2" />
    <line x1="7" y1="11" x2="17" y2="11" />
    <circle cx="8" cy="15.5" r="1" fill="currentColor" stroke="none" />
    <circle cx="12" cy="15.5" r="1" fill="currentColor" stroke="none" />
    <circle cx="16" cy="15.5" r="1" fill="currentColor" stroke="none" />
  </svg>
);

export const IconArrowDown: Icon = (props) => (
  <svg {...base} {...props}>
    <line x1="12" y1="4" x2="12" y2="20" />
    <polyline points="5 13 12 20 19 13" />
  </svg>
);

export const IconArrowUp: Icon = (props) => (
  <svg {...base} {...props}>
    <line x1="12" y1="20" x2="12" y2="4" />
    <polyline points="5 11 12 4 19 11" />
  </svg>
);

export const IconChart: Icon = (props) => (
  <svg {...base} {...props}>
    <line x1="3" y1="20" x2="21" y2="20" />
    <rect x="6" y="11" width="3" height="9" />
    <rect x="11" y="6" width="3" height="14" />
    <rect x="16" y="14" width="3" height="6" />
  </svg>
);

export const IconTransfer: Icon = (props) => (
  <svg {...base} {...props}>
    <polyline points="6 4 3 7 6 10" />
    <line x1="3" y1="7" x2="17" y2="7" />
    <polyline points="18 14 21 17 18 20" />
    <line x1="21" y1="17" x2="7" y2="17" />
  </svg>
);

export const IconBarcode: Icon = (props) => (
  <svg {...base} {...props}>
    <line x1="4" y1="6" x2="4" y2="18" />
    <line x1="7" y1="6" x2="7" y2="18" />
    <line x1="10" y1="6" x2="10" y2="18" strokeWidth="2.6" />
    <line x1="13" y1="6" x2="13" y2="18" />
    <line x1="16" y1="6" x2="16" y2="18" strokeWidth="2.6" />
    <line x1="19" y1="6" x2="19" y2="18" />
  </svg>
);

export const IconTrash: Icon = (props) => (
  <svg {...base} {...props}>
    <polyline points="4 7 20 7" />
    <path d="M9 7V4h6v3" />
    <path d="M6 7l1 13h10l1-13" />
    <line x1="10" y1="11" x2="10" y2="17" />
    <line x1="14" y1="11" x2="14" y2="17" />
  </svg>
);

export const IconRefresh: Icon = (props) => (
  <svg {...base} {...props}>
    <polyline points="20 4 20 10 14 10" />
    <path d="M20 10A8 8 0 1 0 17.5 17.5" />
  </svg>
);

// "Merma" card icon — discarded box silhouette with a warning slash.
export const IconWaste: Icon = (props) => (
  <svg {...base} {...props}>
    <path d="M5 7l1 13h12l1-13" />
    <line x1="3" y1="7" x2="21" y2="7" />
    <line x1="9" y1="4" x2="15" y2="4" />
    <line x1="9" y1="11" x2="15" y2="17" />
    <line x1="15" y1="11" x2="9" y2="17" />
  </svg>
);

// Person with a tag — the "employee perk" card. Same line weight as the
// other hub icons so the grid stays visually balanced.
export const IconEmployee: Icon = (props) => (
  <svg {...base} {...props}>
    <circle cx="10" cy="8" r="3.5" />
    <path d="M3 20c0-3.5 3.1-6 7-6s7 2.5 7 6" />
    <path d="M16 4l4 0 0 4-4 4-4-4 4-4z" />
    <circle cx="18" cy="6" r="0.8" fill="currentColor" stroke="none" />
  </svg>
);
