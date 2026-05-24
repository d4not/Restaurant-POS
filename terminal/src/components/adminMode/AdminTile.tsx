// A single Launchpad tile. Renders the number accelerator, icon chip, title,
// and hint. The visual states (hover / focus / disabled) come from admin.css —
// here we just stamp the markup and let the stylesheet do the heavy lifting.
//
// The tile is a real <button>, so Tab navigation and Enter work out of the
// box. The parent grid additionally drives focus programmatically for the
// arrow-key flow.

import { forwardRef } from 'react';
import { adminStyles, tileStatusDotStyle } from './styles';
import { ACCENT_COLORS, type AdminTileDef } from './tiles';
import { useTranslation } from '../../i18n';

interface AdminTileProps {
  tile: AdminTileDef;
  disabled?: boolean;
  /** Optional override for the hint (e.g. dynamic shift status). */
  hintOverride?: string;
  /** Optional status dot rendered before the hint (e.g. green when shift open). */
  statusDotColor?: string;
  /** Stagger index — used for the mount animation delay. */
  index: number;
  onClick: () => void;
}

export const AdminTile = forwardRef<HTMLButtonElement, AdminTileProps>(
  function AdminTile(
    { tile, disabled, hintOverride, statusDotColor, index, onClick },
    ref,
  ) {
    const { t } = useTranslation();
    const accent = ACCENT_COLORS[tile.accent];
    const hint =
      hintOverride ?? (tile.hintKey ? t(tile.hintKey) : undefined);

    return (
      <button
        ref={ref}
        type="button"
        className="admin-tile admin-mount-up"
        style={{
          ...adminStyles.tile,
          animationDelay: `${60 + index * 35}ms`,
        }}
        disabled={disabled}
        aria-disabled={disabled}
        aria-label={t(tile.titleKey)}
        data-tile-id={tile.id}
        onClick={() => {
          if (!disabled) onClick();
        }}
      >
        <span aria-hidden="true" style={adminStyles.tileNumber}>
          {tile.number}
        </span>
        <span style={{ ...adminStyles.tileIconWrap, background: accent }}>
          <tile.Icon style={{ fontSize: 22 }} />
        </span>
        <span aria-hidden="true" style={adminStyles.tileSpacer} />
        <span style={adminStyles.tileTitle}>{t(tile.titleKey)}</span>
        {hint && (
          <span style={adminStyles.tileHint}>
            {statusDotColor && (
              <span aria-hidden="true" style={tileStatusDotStyle(statusDotColor)} />
            )}
            {hint}
          </span>
        )}
      </button>
    );
  },
);
