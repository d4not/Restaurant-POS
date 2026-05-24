// Compact section card for the new principal launcher. Replaces the large
// AdminSectionCard variant that dominated the centre-greeting layout.
//
// What changed vs AdminSectionCard
//   • Title is demoted from Playfair 17px to a small DM Sans eyebrow
//     (11px uppercase tracked) so the live signal becomes the visual lead.
//     This is the structural fix for the P0 "two competing Playfair lines"
//     critique finding.
//   • Card is ~140px wide and sits in a single horizontal row of five,
//     not in a 3-2 grid around a greeting.
//   • Padding and minHeight reduced to match the new vertical rhythm
//     (~120px tall vs the old 138px+).
//   • CTA tint and all keyboard/hover/focus behavior preserved via the
//     existing .admin-tile / .admin-tile-cta classes.

import { forwardRef, type ReactNode } from 'react';
import { ACCENT_COLORS, type AdminSectionDef } from './tiles';
import { useTranslation } from '../../i18n';

interface MiniSectionCardProps {
  section: AdminSectionDef;
  number: number;
  disabled?: boolean;
  cta?: boolean;
  live?: ReactNode;
  index: number;
  onClick: () => void;
}

export const MiniSectionCard = forwardRef<HTMLButtonElement, MiniSectionCardProps>(
  function MiniSectionCard(
    { section, number, disabled, cta, live, index, onClick },
    ref,
  ) {
    const { t } = useTranslation();
    const accent = ACCENT_COLORS[section.accent];
    const title = t(section.titleKey);

    const className = [
      'admin-tile',
      'admin-mini-card',
      'admin-mount-up',
      cta ? 'admin-tile-cta' : '',
    ]
      .filter(Boolean)
      .join(' ');

    return (
      <button
        ref={ref}
        type="button"
        className={className}
        style={{ animationDelay: `${60 + index * 28}ms` }}
        disabled={disabled}
        aria-disabled={disabled}
        aria-label={title}
        data-section-id={section.id}
        onClick={() => {
          if (!disabled) onClick();
        }}
      >
        <span className="admin-mini-card-header">
          <span
            className="admin-mini-card-icon"
            style={{ background: accent }}
            aria-hidden="true"
          >
            <section.Icon style={{ fontSize: 18 }} />
          </span>
          <span className="admin-mini-card-num" aria-hidden="true">
            {number}
          </span>
        </span>
        <span className="admin-mini-card-title">{title}</span>
        {live && <span className="admin-mini-card-live">{live}</span>}
      </button>
    );
  },
);
