// Picker modal: lists modifier groups that aren't already attached to the
// product, with a search box. Tapping a row attaches the group and closes.

import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useTranslation } from '../../../../i18n';
import { ApiError } from '../../../../api/client';
import { Spinner } from '../../../Spinner';
import { IconClose } from '../../../Icons';
import { useAllModifierGroups } from '../../../../hooks/useModifierGroups';
import { useAttachModifierGroup } from '../../../../hooks/useProducts';

interface Props {
  open: boolean;
  onClose: () => void;
  productId: string;
  attachedIds: string[];
  onAttached?: (msg: string) => void;
  onError?: (msg: string) => void;
}

export function AttachModifierGroupModal({
  open,
  onClose,
  productId,
  attachedIds,
  onAttached,
  onError,
}: Props) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [serverError, setServerError] = useState<string | null>(null);

  const groupsQ = useAllModifierGroups();
  const attachMut = useAttachModifierGroup(productId);

  useEffect(() => {
    if (!open) {
      setSearch('');
      setServerError(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented && !attachMut.isPending) {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [open, onClose, attachMut.isPending]);

  const attachedSet = useMemo(() => new Set(attachedIds), [attachedIds]);
  const groups = useMemo(() => {
    const items = groupsQ.data ?? [];
    const q = search.trim().toLowerCase();
    return items
      .filter((g) => !attachedSet.has(g.id))
      .filter((g) => (q ? g.name.toLowerCase().includes(q) : true));
  }, [groupsQ.data, attachedSet, search]);

  if (!open) return null;

  const onAttach = async (groupId: string) => {
    setServerError(null);
    try {
      await attachMut.mutateAsync(groupId);
      onAttached?.(t('admin.productDetail.modifierGroups.attached'));
      onClose();
    } catch (err) {
      const msg =
        err instanceof ApiError && err.message
          ? err.message
          : err instanceof Error
            ? err.message
            : t('admin.productDetail.saveError');
      setServerError(msg);
      onError?.(msg);
    }
  };

  return (
    <div
      style={scrim}
      onClick={() => {
        if (!attachMut.isPending) onClose();
      }}
    >
      <div style={panel} onClick={(e) => e.stopPropagation()}>
        <div style={head}>
          <h3 style={title}>{t('admin.productDetail.attachModal.title')}</h3>
          <button
            type="button"
            onClick={onClose}
            style={closeBtn}
            disabled={attachMut.isPending}
            aria-label={t('common.close')}
          >
            <IconClose style={{ fontSize: 14 }} />
          </button>
        </div>

        <div style={body}>
          {serverError && <div style={errorBanner}>{serverError}</div>}

          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('admin.productDetail.attachModal.searchPlaceholder')}
            style={textInput}
          />

          {groupsQ.isLoading ? (
            <div style={spinnerWrap}>
              <Spinner />
            </div>
          ) : groups.length === 0 ? (
            <div style={emptyState}>
              <p style={emptyTitle}>
                {attachedIds.length > 0 && !search
                  ? t('admin.productDetail.attachModal.emptyAllAttached')
                  : t('admin.productDetail.attachModal.empty')}
              </p>
            </div>
          ) : (
            <div style={list}>
              {groups.map((g) => {
                const swap = g.type === 'SWAP';
                const def = swap
                  ? g.modifiers?.find((m) => m.is_default)
                  : null;
                return (
                  <button
                    key={g.id}
                    type="button"
                    style={listRow}
                    onClick={() => onAttach(g.id)}
                    disabled={attachMut.isPending}
                  >
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={rowName}>
                        <span>{g.name}</span>
                        <span style={{ ...typeBadge, ...(swap ? badgeBlue : badgeGray) }}>
                          {g.type}
                        </span>
                        {g.required && (
                          <span style={{ ...typeBadge, ...badgeGold }}>
                            {t('admin.productDetail.modifierGroups.required')}
                          </span>
                        )}
                      </div>
                      <div style={rowMeta}>
                        {`${g.modifiers?.length ?? 0} mods · min ${g.min_selection} · max ${g.max_selection}`}
                        {swap && def && (
                          <span> · {t('admin.productDetail.modifierGroups.defaultLabel')} {def.name}</span>
                        )}
                        {swap && !def && (
                          <span style={{ color: 'var(--red)' }}>
                            {' · '}
                            {t('admin.productDetail.modifierGroups.noDefault')}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Styles ────────────────────────────────────────────────── */

const scrim: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(44,36,32,0.42)',
  zIndex: 220,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 24,
};

const panel: CSSProperties = {
  width: 'min(560px, 100%)',
  maxHeight: '88vh',
  background: 'var(--bg2)',
  borderRadius: 14,
  boxShadow: '0 24px 64px rgba(0,0,0,0.32)',
  border: '1px solid var(--border)',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
};

const head: CSSProperties = {
  padding: '18px 20px 14px',
  borderBottom: '1px solid var(--border)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
};

const title: CSSProperties = {
  fontFamily: "'Playfair Display', serif",
  fontSize: 20,
  fontWeight: 600,
  color: 'var(--text1)',
  margin: 0,
};

const closeBtn: CSSProperties = {
  width: 34,
  height: 34,
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'var(--bg)',
  color: 'var(--text2)',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const body: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
  padding: '16px 20px 20px',
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
};

const errorBanner: CSSProperties = {
  padding: '10px 12px',
  borderRadius: 8,
  border: '1px solid rgba(196,80,64,0.30)',
  background: 'rgba(196,80,64,0.08)',
  color: 'var(--red)',
  fontSize: 13,
};

const textInput: CSSProperties = {
  height: 38,
  border: '1px solid var(--border)',
  borderRadius: 8,
  background: 'var(--bg)',
  padding: '0 12px',
  fontSize: 14,
  color: 'var(--text1)',
  fontFamily: 'inherit',
  outline: 'none',
};

const spinnerWrap: CSSProperties = {
  padding: 24,
  display: 'flex',
  justifyContent: 'center',
};

const emptyState: CSSProperties = {
  padding: '24px 8px',
  textAlign: 'center',
};

const emptyTitle: CSSProperties = {
  fontSize: 13,
  color: 'var(--text3)',
  margin: 0,
};

const list: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};

const listRow: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '12px 14px',
  borderRadius: 10,
  border: '1px solid var(--border)',
  background: 'var(--bg)',
  cursor: 'pointer',
  textAlign: 'left',
  fontFamily: 'inherit',
  color: 'var(--text1)',
};

const rowName: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  fontSize: 14,
  fontWeight: 600,
  color: 'var(--text1)',
  flexWrap: 'wrap',
};

const rowMeta: CSSProperties = {
  fontSize: 11,
  color: 'var(--text3)',
  marginTop: 4,
  lineHeight: 1.4,
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
