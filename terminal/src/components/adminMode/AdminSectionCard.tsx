// Top-level card on the Admin launcher. Mirrors AdminTile visually so the
// section grid feels like a natural parent of the tile grid — same chrome,
// same focus model — but instead of firing an action it drills into the
// section's tile grid.
//
// The bottom of the card carries a `live` slot: a status block produced by
// the per-section components in sectionLive.tsx. The slot is what makes
// the launcher a triage surface instead of a category divider — the
// operator gets the shift state, today's revenue, the low-stock count, etc.
// at a glance without drilling in.
//
// `cta` adds a gold-tinted border for the closed-shift Operations state.
// Locked-for-role cards skip the live slot and render a quiet role label.

import { forwardRef, type ReactNode } from 'react';
import { adminStyles } from './styles';
import { ACCENT_COLORS, type AdminSectionDef } from './tiles';
import { useTranslation } from '../../i18n';

interface AdminSectionCardProps {
  section: AdminSectionDef;
  /** Section-local number (1-N) shown in the corner. Drives the hotkey too. */
  number: number;
  disabled?: boolean;
  /** When true, the card adopts the gold-tinted CTA chrome. Reserved for
   *  the closed-shift Operations state today; other cards stay calm. */
  cta?: boolean;
  /** Status block rendered at the bottom of the card. Per-section
   *  components in sectionLive.tsx own the content. */
  live?: ReactNode;
  /** Stagger index used for the mount animation delay. */
  index: number;
  onClick: () => void;
}

export const AdminSectionCard = forwardRef<HTMLButtonElement, AdminSectionCardProps>(
  function AdminSectionCard(
    { section, number, disabled, cta, live, index, onClick },
    ref,
  ) {
    const { t } = useTranslation();
    const accent = ACCENT_COLORS[section.accent];
    const title = t(section.titleKey);

    const className = [
      'admin-tile',
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
        style={{
          ...adminStyles.tile,
          animationDelay: `${60 + index * 35}ms`,
        }}
        disabled={disabled}
        aria-disabled={disabled}
        aria-label={title}
        data-section-id={section.id}
        onClick={() => {
          if (!disabled) onClick();
        }}
      >
        <span aria-hidden="true" style={adminStyles.tileNumber}>
          {number}
        </span>
        <span style={{ ...adminStyles.tileIconWrap, background: accent }}>
          <section.Icon style={{ fontSize: 22 }} />
        </span>
        <span aria-hidden="true" style={adminStyles.tileSpacer} />
        <span style={adminStyles.tileTitle}>{title}</span>
        {live && <span style={adminStyles.tileHint}>{live}</span>}
      </button>
    );
  },
);
