// Renders one attached modifier group as a card. Shows the group meta on top
// (type, required, min/max, default), the list of active modifiers below
// (with their +price / ratio / fixed qty / supply reference), and the
// "+ Override" / "Edit override" / remove-override buttons per modifier.

import type { CSSProperties } from 'react';
import { useTranslation } from '../../../../i18n';
import { formatMoney, formatNumber } from '../../../../utils/format';
import type {
  Modifier,
  ModifierGroupType,
  ModifierProductOverride,
  ProductModifierGroupLink,
} from '../../../../api/products';

interface Props {
  link: ProductModifierGroupLink;
  overrides: ModifierProductOverride[];
  onDetach: (link: ProductModifierGroupLink) => void;
  detaching: boolean;
  onOverride: (
    modifier: Modifier,
    groupType: ModifierGroupType,
    existing: ModifierProductOverride | null,
  ) => void;
  onDeleteOverride: (modifier: Modifier) => void;
}

export function ModifierGroupCard({
  link,
  overrides,
  onDetach,
  detaching,
  onOverride,
  onDeleteOverride,
}: Props) {
  const { t } = useTranslation();
  const g = link.modifier_group;
  const isSwap = g.type === 'SWAP';
  const activeMods = (g.modifiers ?? []).filter((m) => m.active);
  const defaultMod = isSwap
    ? activeMods.find((m) => m.is_default) ?? null
    : null;
  const overrideByModifierId = new Map(overrides.map((o) => [o.modifier_id, o]));

  return (
    <div style={card}>
      <div style={cardHead}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={titleRow}>
            <span style={titleText}>{g.name}</span>
            <span style={{ ...typeBadge, ...(isSwap ? badgeBlue : badgeGray) }}>
              {g.type}
            </span>
            {g.required && (
              <span style={{ ...typeBadge, ...badgeGold }}>
                {t('admin.productDetail.modifierGroups.required')}
              </span>
            )}
          </div>
          <div style={metaRow}>
            <span>min {g.min_selection}</span>
            <span style={metaDot}>·</span>
            <span>max {g.max_selection}</span>
            {isSwap && defaultMod && (
              <>
                <span style={metaDot}>·</span>
                <span>
                  {t('admin.productDetail.modifierGroups.defaultLabel')}{' '}
                  <span style={{ fontWeight: 600 }}>{defaultMod.name}</span>
                </span>
              </>
            )}
            {isSwap && !defaultMod && (
              <>
                <span style={metaDot}>·</span>
                <span style={{ color: 'var(--red)', fontWeight: 600 }}>
                  {t('admin.productDetail.modifierGroups.noDefault')}
                </span>
              </>
            )}
          </div>
        </div>
        <button
          type="button"
          style={btnGhost}
          onClick={() => onDetach(link)}
          disabled={detaching}
        >
          {t('admin.productDetail.modifierGroups.detach')}
        </button>
      </div>

      {activeMods.length === 0 ? (
        <p style={emptyMods}>
          {t('admin.productDetail.modifierGroups.noModifiers')}
        </p>
      ) : (
        <div style={modList}>
          {activeMods.map((m) => {
            const override = overrideByModifierId.get(m.id) ?? null;
            return (
              <div key={m.id} style={modRow}>
                <div style={modLeft}>
                  <span style={modName}>{m.name}</span>
                  {Number(m.extra_price) > 0 && (
                    <span style={extraPrice}>+{formatMoney(m.extra_price)}</span>
                  )}
                  {isSwap ? (
                    <span style={metaSub}>
                      ratio{' '}
                      <span style={{ fontWeight: 600 }}>
                        {formatNumber(m.ratio ?? 1, 2)}×
                      </span>
                    </span>
                  ) : m.supply_quantity ? (
                    <span style={metaSub}>
                      {Number(m.supply_quantity)} {m.supply_unit ?? ''}{' '}
                      {m.supply && <>· {m.supply.name}</>}
                    </span>
                  ) : null}
                  {override && (
                    <span style={overridePill}>
                      {override.override_type === 'RATIO'
                        ? `${formatNumber(override.override_ratio ?? 0, 2)}×`
                        : `${Number(override.override_quantity ?? 0)} ${override.override_unit ?? ''}`}
                    </span>
                  )}
                </div>
                <div style={modActions}>
                  <button
                    type="button"
                    style={btnGhostSm}
                    onClick={() => onOverride(m, g.type, override)}
                  >
                    {override
                      ? t('admin.productDetail.modifierGroups.overrideEdit')
                      : t('admin.productDetail.modifierGroups.overrideAdd')}
                  </button>
                  {override && (
                    <button
                      type="button"
                      style={btnGhostSm}
                      onClick={() => onDeleteOverride(m)}
                      aria-label={t('admin.productDetail.modifierGroups.overrideRemove')}
                    >
                      ✕
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ── Styles ────────────────────────────────────────────────── */

const card: CSSProperties = {
  background: 'var(--bg2)',
  border: '1px solid var(--border)',
  borderRadius: 12,
  padding: 16,
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
};

const cardHead: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: 12,
};

const titleRow: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 8,
};

const titleText: CSSProperties = {
  fontFamily: "'Playfair Display', serif",
  fontSize: 15,
  fontWeight: 600,
  color: 'var(--text1)',
};

const typeBadge: CSSProperties = {
  display: 'inline-block',
  padding: '2px 8px',
  borderRadius: 999,
  fontSize: 9,
  fontWeight: 700,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
};

const badgeBlue: CSSProperties = {
  background: 'rgba(42,106,200,0.10)',
  color: '#2a6ac8',
  border: '1px solid rgba(42,106,200,0.30)',
};

const badgeGray: CSSProperties = {
  background: 'rgba(168,152,136,0.16)',
  color: 'var(--text2)',
  border: '1px solid rgba(168,152,136,0.36)',
};

const badgeGold: CSSProperties = {
  background: 'rgba(201,164,92,0.12)',
  color: 'var(--gold)',
  border: '1px solid rgba(201,164,92,0.30)',
};

const metaRow: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 6,
  fontSize: 11,
  color: 'var(--text3)',
  marginTop: 6,
};

const metaDot: CSSProperties = { color: 'var(--text3)' };

const btnGhost: CSSProperties = {
  padding: '0 12px',
  height: 32,
  borderRadius: 6,
  border: '1px solid var(--border)',
  background: 'var(--bg)',
  color: 'var(--text2)',
  fontSize: 12,
  fontWeight: 500,
  cursor: 'pointer',
  fontFamily: 'inherit',
};

const btnGhostSm: CSSProperties = {
  padding: '0 10px',
  height: 28,
  borderRadius: 6,
  border: '1px solid var(--border)',
  background: 'var(--bg)',
  color: 'var(--text2)',
  fontSize: 11,
  fontWeight: 500,
  cursor: 'pointer',
  fontFamily: 'inherit',
};

const emptyMods: CSSProperties = {
  margin: 0,
  fontSize: 12,
  color: 'var(--text3)',
  fontStyle: 'italic',
};

const modList: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};

const modRow: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 10,
  padding: '8px 12px',
  border: '1px solid var(--border)',
  borderRadius: 8,
  background: 'var(--bg)',
};

const modLeft: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 8,
  minWidth: 0,
};

const modName: CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: 'var(--text1)',
};

const extraPrice: CSSProperties = {
  fontSize: 12,
  color: 'var(--gold)',
  fontWeight: 600,
};

const metaSub: CSSProperties = {
  fontSize: 11,
  color: 'var(--text3)',
};

const overridePill: CSSProperties = {
  display: 'inline-block',
  padding: '2px 8px',
  borderRadius: 999,
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.04em',
  background: 'rgba(201,164,92,0.14)',
  color: 'var(--gold)',
  border: '1px solid rgba(201,164,92,0.36)',
};

const modActions: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  flexShrink: 0,
};
