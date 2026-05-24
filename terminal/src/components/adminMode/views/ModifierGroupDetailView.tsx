// Catalog · Modifier-group detail — full-screen editor for one group.
//
// Opened from a modifier-groups list view when a manager taps a row.
// Header form (name, type, selection rules) + modifiers table + linked
// products section. Follows the ProductDetailView pattern: inline editing,
// SaveBar for unsaved changes, modal forms for sub-items, confirm dialogs.
//
// Backend touch points
//   GET    /api/v1/modifier-groups/:id              — load detail
//   PATCH  /api/v1/modifier-groups/:id              — header edits
//   DELETE /api/v1/modifier-groups/:id              — delete group
//   POST   /api/v1/modifier-groups/:id/modifiers    — add modifier
//   PATCH  /api/v1/modifier-groups/:id/modifiers/:m — edit modifier
//   DELETE /api/v1/modifier-groups/:id/modifiers/:m — delete modifier
//   GET    /api/v1/modifier-groups/:id/products     — linked products

import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { AdminViewShell } from './AdminViewShell';
import { SaveBar } from './productDetail/SaveBar';
import { Spinner } from '../../Spinner';
import { useTranslation } from '../../../i18n';
import { ApiError } from '../../../api/client';
import { formatMoney } from '../../../utils/format';
import type { Modifier, ModifierGroupType } from '../../../api/products';
import type {
  CreateModifierInput,
  UpdateModifierInput,
} from '../../../api/modifier-groups';
import {
  useModifierGroup,
  useUpdateModifierGroup,
  useDeleteModifierGroup,
  useCreateModifier,
  useUpdateModifier,
  useDeleteModifier,
  useGroupLinkedProducts,
} from '../../../hooks/useModifierGroups';

/* ── Types ─────────────────────────────────────────────────────────────── */

interface Props {
  groupId: string;
  onBack: () => void;
  onSaved: (msg: string) => void;
  onError: (msg: string) => void;
  onDeleted?: () => void;
}

interface HeaderFormState {
  name: string;
  type: ModifierGroupType;
  min_selection: number;
  max_selection: number;
  required: boolean;
  display_order: number;
}

interface ModifierFormState {
  name: string;
  extra_price: string;       // display string, dollars
  ratio: string;             // display string
  supply_quantity: string;    // display string
  supply_unit: string;
  is_default: boolean;
  active: boolean;
  display_order: string;     // display string
}

/* ── Helpers ───────────────────────────────────────────────────────────── */

function buildHeaderForm(g: { name: string; type: ModifierGroupType; min_selection: number; max_selection: number; required: boolean; display_order: number }): HeaderFormState {
  return {
    name: g.name,
    type: g.type,
    min_selection: g.min_selection,
    max_selection: g.max_selection,
    required: g.required,
    display_order: g.display_order,
  };
}

function blankModifierForm(groupType: ModifierGroupType): ModifierFormState {
  return {
    name: '',
    extra_price: '0',
    ratio: groupType === 'SWAP' ? '1' : '1',
    supply_quantity: '',
    supply_unit: '',
    is_default: false,
    active: true,
    display_order: '0',
  };
}

function modifierToForm(m: Modifier): ModifierFormState {
  return {
    name: m.name,
    extra_price: String(Number(m.extra_price) / 100),
    ratio: String(Number(m.ratio)),
    supply_quantity: m.supply_quantity ? String(Number(m.supply_quantity)) : '',
    supply_unit: m.supply_unit ?? '',
    is_default: m.is_default,
    active: m.active,
    display_order: String(m.display_order),
  };
}

function productTypeBadge(type: string): CSSProperties {
  switch (type) {
    case 'DISH':
      return { background: 'rgba(201,164,92,0.14)', color: '#8a6d2a', border: '1px solid rgba(201,164,92,0.35)' };
    case 'PREPARATION':
      return { background: 'rgba(74,140,92,0.12)', color: 'var(--green)', border: '1px solid rgba(74,140,92,0.30)' };
    default:
      return { background: 'rgba(42,106,200,0.10)', color: '#2a6ac8', border: '1px solid rgba(42,106,200,0.30)' };
  }
}

/* ── Component ─────────────────────────────────────────────────────────── */

export function ModifierGroupDetailView({
  groupId,
  onBack,
  onSaved,
  onError,
  onDeleted,
}: Props) {
  const { t } = useTranslation();
  const groupQ = useModifierGroup(groupId);
  const linkedQ = useGroupLinkedProducts(groupId);

  const group = groupQ.data ?? null;

  /* ── Header form state ───────────────────────────────────────── */

  const [form, setForm] = useState<HeaderFormState | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [resyncToken, setResyncToken] = useState(0);

  useEffect(() => {
    if (!group) return;
    setForm(buildHeaderForm(group));
    setFieldErrors({});
    setSaveError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group?.id, resyncToken]);

  const setField = <K extends keyof HeaderFormState>(
    key: K,
    value: HeaderFormState[K],
  ) => {
    setForm((f) => (f ? { ...f, [key]: value } : f));
    setFieldErrors((e) => {
      if (!(key in e)) return e;
      const rest = { ...e };
      delete rest[key as string];
      return rest;
    });
    setSaveError(null);
  };

  const isDirty = useMemo(() => {
    if (!group || !form) return false;
    const original = buildHeaderForm(group);
    return (Object.keys(form) as (keyof HeaderFormState)[]).some(
      (k) => form[k] !== original[k],
    );
  }, [group, form]);

  /* ── Mutations ───────────────────────────────────────────────── */

  const updateMut = useUpdateModifierGroup();
  const deleteMut = useDeleteModifierGroup();
  const updateModMut = useUpdateModifier(groupId);
  const deleteModMut = useDeleteModifier(groupId);

  const onDiscard = () => {
    if (!group) return;
    setForm(buildHeaderForm(group));
    setFieldErrors({});
    setSaveError(null);
  };

  const onSaveHeader = async () => {
    if (!group || !form) return;
    const errors: Record<string, string> = {};
    if (!form.name.trim()) {
      errors.name = t('admin.modifierGroupDetail.validation.nameRequired');
    }
    if (form.max_selection < 1) {
      errors.max_selection = t('admin.modifierGroupDetail.validation.maxSelectionMin');
    }
    if (form.min_selection < 0) {
      errors.min_selection = t('admin.modifierGroupDetail.validation.minSelectionMin');
    }
    if (form.min_selection > form.max_selection) {
      errors.min_selection = t('admin.modifierGroupDetail.validation.minGtMax');
    }
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    const original = buildHeaderForm(group);
    const payload: Record<string, unknown> = {};
    if (form.name.trim() !== original.name) payload.name = form.name.trim();
    if (form.type !== original.type) payload.type = form.type;
    if (form.min_selection !== original.min_selection) payload.min_selection = form.min_selection;
    if (form.max_selection !== original.max_selection) payload.max_selection = form.max_selection;
    if (form.required !== original.required) payload.required = form.required;
    if (form.display_order !== original.display_order) payload.display_order = form.display_order;

    if (Object.keys(payload).length === 0) {
      setFieldErrors({});
      return;
    }

    setSaveError(null);
    try {
      await updateMut.mutateAsync({ id: group.id, input: payload });
      setFieldErrors({});
      setResyncToken((n) => n + 1);
      onSaved(t('admin.modifierGroupDetail.saveSuccess'));
    } catch (err) {
      const msg =
        err instanceof ApiError && err.message
          ? err.message
          : err instanceof Error
            ? err.message
            : t('admin.modifierGroupDetail.saveError');
      setSaveError(msg);
    }
  };

  /* ── Delete group ────────────────────────────────────────────── */

  const [confirmDelete, setConfirmDelete] = useState(false);

  const onDeleteGroup = async () => {
    try {
      await deleteMut.mutateAsync(groupId);
      onSaved(t('admin.modifierGroupDetail.deleteSuccess'));
      onDeleted?.();
      onBack();
    } catch (err) {
      setConfirmDelete(false);
      onError(
        err instanceof ApiError && err.message
          ? err.message
          : t('admin.modifierGroupDetail.saveError'),
      );
    }
  };

  /* ── Modifier modal state ────────────────────────────────────── */

  const [modModal, setModModal] = useState<{
    open: boolean;
    modifier: Modifier | null;
  }>({ open: false, modifier: null });

  /* ── Delete modifier confirm ─────────────────────────────────── */

  const [confirmModDelete, setConfirmModDelete] = useState<Modifier | null>(null);

  const onDeleteModifier = async (m: Modifier) => {
    try {
      await deleteModMut.mutateAsync(m.id);
      setConfirmModDelete(null);
      onSaved(t('admin.modifierGroupDetail.modifierDeleteSuccess'));
    } catch (err) {
      setConfirmModDelete(null);
      onError(
        err instanceof ApiError && err.message
          ? err.message
          : t('admin.modifierGroupDetail.saveError'),
      );
    }
  };

  /* ── Set default modifier (SWAP) ─────────────────────────────── */

  const onSetDefault = async (m: Modifier) => {
    if (m.is_default || !group) return;
    try {
      // Clear the current default first, then set the new one. The backend
      // should handle this atomically, but we ensure correctness by sending
      // both mutations in sequence.
      const currentDefault = group.modifiers.find((mod) => mod.is_default && mod.id !== m.id);
      if (currentDefault) {
        await updateModMut.mutateAsync({
          modifierId: currentDefault.id,
          input: { is_default: false },
        });
      }
      await updateModMut.mutateAsync({
        modifierId: m.id,
        input: { is_default: true },
      });
    } catch (err) {
      onError(
        err instanceof ApiError && err.message
          ? err.message
          : t('admin.modifierGroupDetail.saveError'),
      );
    }
  };

  /* ── Render ──────────────────────────────────────────────────── */

  if (groupQ.isLoading) {
    return (
      <AdminViewShell titleKey="admin.modifierGroupDetail.title" onBack={onBack}>
        <div style={spinnerWrap}>
          <Spinner />
        </div>
      </AdminViewShell>
    );
  }

  if (groupQ.error || !group) {
    return (
      <AdminViewShell titleKey="admin.modifierGroupDetail.title" onBack={onBack}>
        <div style={emptyWrap}>
          <p style={emptyTitle}>{t('admin.modifierGroupDetail.loadError')}</p>
          <p style={emptyHint}>
            {(groupQ.error as Error | null)?.message ??
              t('admin.modifierGroupDetail.loadErrorHint')}
          </p>
        </div>
      </AdminViewShell>
    );
  }

  const isSwap = (form?.type ?? group.type) === 'SWAP';
  const modifiers = group.modifiers;
  const modCount = modifiers.length;
  const TABLE_COLS = isSwap
    ? 'minmax(180px, 2fr) 100px 140px 80px 80px 80px'
    : 'minmax(180px, 2fr) 100px 180px 80px 80px';

  return (
    <AdminViewShell
      titleKey="admin.modifierGroupDetail.title"
      onBack={onBack}
      headerActions={
        <span style={headerBadges}>
          <span style={{ ...typePill, ...(isSwap ? typePillSwap : typePillAdd) }}>
            {isSwap ? 'SWAP' : 'ADD'}
          </span>
          <span style={modCountBadge}>
            {modCount} {modCount === 1 ? 'modifier' : 'modifiers'}
          </span>
        </span>
      }
    >
      {/* SaveBar */}
      {isDirty && form && (
        <SaveBar
          saving={updateMut.isPending}
          onDiscard={onDiscard}
          onSave={onSaveHeader}
        />
      )}

      {/* Top row — group name + delete */}
      <div style={topRow}>
        <h3 style={groupNameDisplay}>{group.name}</h3>
        <button
          type="button"
          style={btnDanger}
          onClick={() => setConfirmDelete(true)}
          disabled={deleteMut.isPending || updateMut.isPending}
        >
          {t('admin.modifierGroupDetail.deleteGroup')}
        </button>
      </div>

      {/* Header form */}
      {form && (
        <div style={formCard}>
          {/* Name — full width */}
          <div style={fieldWrap}>
            <label style={fieldLabel}>
              {t('admin.modifierGroupDetail.field.name')}
            </label>
            <input
              style={{
                ...fieldInput,
                ...(fieldErrors.name ? fieldInputError : {}),
              }}
              value={form.name}
              onChange={(e) => setField('name', e.target.value)}
              placeholder="e.g. Milk Type"
            />
            {fieldErrors.name && <span style={errorText}>{fieldErrors.name}</span>}
          </div>

          {/* 2-col grid */}
          <div style={formGrid}>
            {/* Type toggle */}
            <div style={fieldWrap}>
              <label style={fieldLabel}>
                {t('admin.modifierGroupDetail.field.type')}
              </label>
              <div style={pillRow}>
                <button
                  type="button"
                  style={{
                    ...pillBtn,
                    ...(form.type === 'SWAP' ? pillBtnActive : {}),
                  }}
                  onClick={() => setField('type', 'SWAP')}
                >
                  SWAP
                </button>
                <button
                  type="button"
                  style={{
                    ...pillBtn,
                    ...(form.type === 'ADD' ? pillBtnActive : {}),
                  }}
                  onClick={() => setField('type', 'ADD')}
                >
                  ADD
                </button>
              </div>
            </div>

            {/* Required toggle */}
            <div style={fieldWrap}>
              <label style={fieldLabel}>
                {t('admin.modifierGroupDetail.field.required')}
              </label>
              <div style={pillRow}>
                <button
                  type="button"
                  style={{
                    ...pillBtn,
                    ...(form.required ? pillBtnActive : {}),
                  }}
                  onClick={() => setField('required', true)}
                >
                  Yes
                </button>
                <button
                  type="button"
                  style={{
                    ...pillBtn,
                    ...(!form.required ? pillBtnActive : {}),
                  }}
                  onClick={() => setField('required', false)}
                >
                  No
                </button>
              </div>
            </div>

            {/* Min selection */}
            <div style={fieldWrap}>
              <label style={fieldLabel}>
                {t('admin.modifierGroupDetail.field.minSelection')}
              </label>
              <input
                type="number"
                min={0}
                style={{
                  ...fieldInput,
                  ...(fieldErrors.min_selection ? fieldInputError : {}),
                }}
                value={form.min_selection}
                onChange={(e) => setField('min_selection', Math.max(0, Number(e.target.value) || 0))}
              />
              {fieldErrors.min_selection && (
                <span style={errorText}>{fieldErrors.min_selection}</span>
              )}
            </div>

            {/* Max selection */}
            <div style={fieldWrap}>
              <label style={fieldLabel}>
                {t('admin.modifierGroupDetail.field.maxSelection')}
              </label>
              <input
                type="number"
                min={1}
                style={{
                  ...fieldInput,
                  ...(fieldErrors.max_selection ? fieldInputError : {}),
                }}
                value={form.max_selection}
                onChange={(e) => setField('max_selection', Math.max(1, Number(e.target.value) || 1))}
              />
              {fieldErrors.max_selection && (
                <span style={errorText}>{fieldErrors.max_selection}</span>
              )}
            </div>

            {/* Display order */}
            <div style={fieldWrap}>
              <label style={fieldLabel}>
                {t('admin.modifierGroupDetail.field.displayOrder')}
              </label>
              <input
                type="number"
                min={0}
                style={fieldInput}
                value={form.display_order}
                onChange={(e) => setField('display_order', Math.max(0, Number(e.target.value) || 0))}
              />
            </div>
          </div>

          {saveError && (
            <p style={{ ...errorText, marginTop: 8 }}>{saveError}</p>
          )}
        </div>
      )}

      {/* ── Modifiers section ──────────────────────────────────── */}
      <section style={section}>
        <div style={sectionHead}>
          <h3 style={sectionTitle}>
            {t('admin.modifierGroupDetail.section.modifiers')}
            <span style={sectionCount}>{modCount}</span>
          </h3>
          <button
            type="button"
            style={btnPrimarySm}
            onClick={() => setModModal({ open: true, modifier: null })}
          >
            {t('admin.modifierGroupDetail.addModifier')}
          </button>
        </div>

        <div style={tableShell}>
          {/* Table head */}
          <div style={{ ...tableHead, gridTemplateColumns: TABLE_COLS }}>
            <span>{t('admin.modifierGroupDetail.col.name')}</span>
            <span style={cellNumHead}>{t('admin.modifierGroupDetail.col.extraPrice')}</span>
            {isSwap ? (
              <span style={cellNumHead}>{t('admin.modifierGroupDetail.col.ratio')}</span>
            ) : (
              <span>{t('admin.modifierGroupDetail.col.supplyQty')}</span>
            )}
            {isSwap && <span>{t('admin.modifierGroupDetail.col.default')}</span>}
            <span>{t('admin.modifierGroupDetail.col.active')}</span>
            <span />
          </div>

          {/* Rows */}
          {modCount === 0 ? (
            <div style={emptyRow}>
              <p style={emptyTitle}>{t('admin.modifierGroupDetail.noModifiers')}</p>
              <p style={emptyHint}>{t('admin.modifierGroupDetail.noModifiersHint')}</p>
            </div>
          ) : (
            modifiers.map((m) => (
              <div
                key={m.id}
                style={{ ...tableRow, gridTemplateColumns: TABLE_COLS }}
              >
                {/* Name */}
                <span style={nameCell}>
                  <span style={nameMain}>{m.name}</span>
                  {m.supply?.name && (
                    <span style={nameSub}>{m.supply.name}</span>
                  )}
                </span>

                {/* Extra price */}
                <span style={cellNum}>{formatMoney(m.extra_price)}</span>

                {/* SWAP: ratio, ADD: supply qty + unit */}
                {isSwap ? (
                  <span style={{ ...cellNum, color: 'var(--text2)' }}>
                    {Number(m.ratio).toFixed(1)}x
                  </span>
                ) : (
                  <span style={{ color: 'var(--text2)', fontSize: 12 }}>
                    {m.supply_quantity
                      ? `${Number(m.supply_quantity)} ${m.supply_unit ?? ''}`
                      : '—'}
                  </span>
                )}

                {/* Default (SWAP only) */}
                {isSwap && (
                  <span>
                    <button
                      type="button"
                      style={m.is_default ? defaultDotActive : defaultDot}
                      onClick={() => onSetDefault(m)}
                      disabled={updateModMut.isPending}
                      aria-label="Set default"
                    >
                      {m.is_default ? '◉' : '○'}
                    </button>
                  </span>
                )}

                {/* Active badge */}
                <span>
                  <span style={{ ...statusBadge, ...(m.active ? statusOk : statusOff) }}>
                    {m.active ? 'Active' : 'Off'}
                  </span>
                </span>

                {/* Actions */}
                <span style={actionsCell}>
                  <button
                    type="button"
                    style={btnGhostSm}
                    onClick={() => setModModal({ open: true, modifier: m })}
                  >
                    {t('common.edit')}
                  </button>
                  <button
                    type="button"
                    style={btnGhostSm}
                    onClick={() => setConfirmModDelete(m)}
                    disabled={deleteModMut.isPending}
                    aria-label={t('common.delete')}
                  >
                    ✕
                  </button>
                </span>
              </div>
            ))
          )}
        </div>
      </section>

      {/* ── Linked products section ────────────────────────────── */}
      <section style={section}>
        <div style={sectionHead}>
          <h3 style={sectionTitle}>
            {t('admin.modifierGroupDetail.section.linkedProducts')}
            {linkedQ.data && (
              <span style={sectionCount}>{linkedQ.data.length}</span>
            )}
          </h3>
        </div>

        <div style={tableShell}>
          {linkedQ.isLoading ? (
            <div style={spinnerWrap}><Spinner /></div>
          ) : !linkedQ.data || linkedQ.data.length === 0 ? (
            <div style={emptyRow}>
              <p style={emptyHint}>{t('admin.modifierGroupDetail.noLinkedProducts')}</p>
            </div>
          ) : (
            linkedQ.data.map((p) => (
              <div key={p.id} style={linkedRow}>
                <span style={nameMain}>{p.name}</span>
                <span style={{ ...linkedTypePill, ...productTypeBadge(p.type) }}>
                  {p.type}
                </span>
                <span style={{ ...statusBadge, ...(p.active ? statusOk : statusOff) }}>
                  {p.active ? 'Active' : 'Off'}
                </span>
              </div>
            ))
          )}
        </div>
      </section>

      {/* ── Modifier form modal ────────────────────────────────── */}
      <ModifierFormModal
        open={modModal.open}
        onClose={() => setModModal({ open: false, modifier: null })}
        groupId={groupId}
        groupType={form?.type ?? group.type}
        modifier={modModal.modifier}
        onSaved={(msg) => onSaved(msg)}
        onError={onError}
      />

      {/* ── Confirm delete group ───────────────────────────────── */}
      {confirmDelete && (
        <ConfirmScrim onCancel={() => setConfirmDelete(false)}>
          <p style={confirmText}>{t('admin.modifierGroupDetail.deleteConfirm')}</p>
          <div style={confirmActions}>
            <button
              type="button"
              style={btnGhostSm}
              onClick={() => setConfirmDelete(false)}
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              style={btnDangerSm}
              onClick={onDeleteGroup}
              disabled={deleteMut.isPending}
            >
              {deleteMut.isPending ? <Spinner size={14} /> : t('common.delete')}
            </button>
          </div>
        </ConfirmScrim>
      )}

      {/* ── Confirm delete modifier ────────────────────────────── */}
      {confirmModDelete && (
        <ConfirmScrim onCancel={() => setConfirmModDelete(null)}>
          <p style={confirmText}>
            {t('admin.modifierGroupDetail.modifierDeleteConfirm').replace(
              '{name}',
              confirmModDelete.name,
            )}
          </p>
          <div style={confirmActions}>
            <button
              type="button"
              style={btnGhostSm}
              onClick={() => setConfirmModDelete(null)}
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              style={btnDangerSm}
              onClick={() => onDeleteModifier(confirmModDelete)}
              disabled={deleteModMut.isPending}
            >
              {deleteModMut.isPending ? <Spinner size={14} /> : t('common.delete')}
            </button>
          </div>
        </ConfirmScrim>
      )}
    </AdminViewShell>
  );
}

/* ── ConfirmScrim ──────────────────────────────────────────────────────── */

function ConfirmScrim({
  onCancel,
  children,
}: {
  onCancel: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onCancel();
      }
    };
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  }, [onCancel]);

  return (
    <div style={scrimStyle} onClick={onCancel}>
      <div style={confirmCard} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

/* ── ModifierFormModal ─────────────────────────────────────────────────── */

function ModifierFormModal({
  open,
  onClose,
  groupId,
  groupType,
  modifier,
  onSaved,
  onError,
}: {
  open: boolean;
  onClose: () => void;
  groupId: string;
  groupType: ModifierGroupType;
  modifier: Modifier | null;
  onSaved: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const { t } = useTranslation();
  const isEdit = modifier !== null;
  const isSwap = groupType === 'SWAP';

  const createMut = useCreateModifier(groupId);
  const updateMut = useUpdateModifier(groupId);

  const [form, setForm] = useState<ModifierFormState>(
    modifier ? modifierToForm(modifier) : blankModifierForm(groupType),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Reset form when modal opens/closes or modifier changes
  useEffect(() => {
    if (open) {
      setForm(modifier ? modifierToForm(modifier) : blankModifierForm(groupType));
      setErrors({});
    }
  }, [open, modifier, groupType]);

  // Capture Esc inside the modal
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  }, [open, onClose]);

  if (!open) return null;

  const setF = (key: keyof ModifierFormState, value: ModifierFormState[keyof ModifierFormState]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => {
      if (!(key in e)) return e;
      const rest = { ...e };
      delete rest[key as string];
      return rest;
    });
  };

  const onSubmit = async () => {
    const errs: Record<string, string> = {};
    if (!form.name.trim()) errs.name = t('admin.modifierGroupDetail.validation.nameRequired');
    const price = Number(form.extra_price);
    if (!Number.isFinite(price) || price < 0) {
      errs.extra_price = t('admin.modifierGroupDetail.validation.priceNonNeg');
    }
    if (isSwap) {
      const r = Number(form.ratio);
      if (!Number.isFinite(r) || r <= 0) {
        errs.ratio = t('admin.modifierGroupDetail.validation.ratioPositive');
      }
    }
    if (form.supply_quantity.trim()) {
      const sq = Number(form.supply_quantity);
      if (!Number.isFinite(sq) || sq <= 0) {
        errs.supply_quantity = t('admin.modifierGroupDetail.validation.supplyQtyPositive');
      }
    }
    const dord = Number(form.display_order);
    if (!Number.isFinite(dord) || dord < 0 || dord !== Math.floor(dord)) {
      errs.display_order = t('admin.modifierGroupDetail.validation.displayOrderInt');
    }
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }

    try {
      if (isEdit && modifier) {
        const input: UpdateModifierInput = {};
        if (form.name.trim() !== modifier.name) input.name = form.name.trim();
        const newPrice = Math.round(price * 100);
        if (newPrice !== Number(modifier.extra_price)) input.extra_price = newPrice;
        if (isSwap && String(Number(form.ratio)) !== String(Number(modifier.ratio))) {
          input.ratio = Number(form.ratio);
        }
        if (form.supply_quantity.trim()) {
          const sq = Number(form.supply_quantity);
          if (sq !== Number(modifier.supply_quantity ?? 0)) input.supply_quantity = sq;
        } else if (modifier.supply_quantity) {
          input.supply_quantity = null;
        }
        if ((form.supply_unit || '') !== (modifier.supply_unit || '')) {
          input.supply_unit = form.supply_unit || null;
        }
        if (form.is_default !== modifier.is_default) input.is_default = form.is_default;
        if (form.active !== modifier.active) input.active = form.active;
        const newOrder = Number(form.display_order);
        if (newOrder !== modifier.display_order) input.display_order = newOrder;

        if (Object.keys(input).length > 0) {
          await updateMut.mutateAsync({ modifierId: modifier.id, input });
        }
        onSaved(t('admin.modifierGroupDetail.modifierSaveSuccess'));
      } else {
        const input: CreateModifierInput = {
          name: form.name.trim(),
          extra_price: Math.round(price * 100),
          active: form.active,
          display_order: Number(form.display_order),
          is_default: form.is_default,
        };
        if (isSwap) input.ratio = Number(form.ratio);
        if (form.supply_quantity.trim()) {
          input.supply_quantity = Number(form.supply_quantity);
        }
        if (form.supply_unit.trim()) {
          input.supply_unit = form.supply_unit.trim();
        }
        await createMut.mutateAsync(input);
        onSaved(t('admin.modifierGroupDetail.modifierCreateSuccess'));
      }
      onClose();
    } catch (err) {
      onError(
        err instanceof ApiError && err.message
          ? err.message
          : err instanceof Error
            ? err.message
            : t('admin.modifierGroupDetail.saveError'),
      );
    }
  };

  const isPending = createMut.isPending || updateMut.isPending;

  return (
    <div style={scrimStyle} onClick={onClose}>
      <div style={modalCard} onClick={(e) => e.stopPropagation()}>
        {/* Modal header */}
        <div style={modalHead}>
          <h3 style={modalTitle}>
            {isEdit
              ? t('admin.modifierGroupDetail.modifierForm.titleEdit')
              : t('admin.modifierGroupDetail.modifierForm.title')}
          </h3>
          <button type="button" style={modalClose} onClick={onClose}>
            ✕
          </button>
        </div>

        {/* Modal body */}
        <div style={modalBody}>
          {/* Name */}
          <div style={fieldWrap}>
            <label style={fieldLabel}>
              {t('admin.modifierGroupDetail.modifierForm.field.name')}
            </label>
            <input
              style={{ ...fieldInput, ...(errors.name ? fieldInputError : {}) }}
              value={form.name}
              onChange={(e) => setF('name', e.target.value)}
              placeholder="e.g. Almond Milk"
              autoFocus
            />
            {errors.name && <span style={errorText}>{errors.name}</span>}
          </div>

          <div style={formGrid}>
            {/* Extra price */}
            <div style={fieldWrap}>
              <label style={fieldLabel}>
                {t('admin.modifierGroupDetail.modifierForm.field.extraPrice')}
              </label>
              <input
                type="number"
                min={0}
                step="0.01"
                style={{ ...fieldInput, ...(errors.extra_price ? fieldInputError : {}) }}
                value={form.extra_price}
                onChange={(e) => setF('extra_price', e.target.value)}
              />
              {errors.extra_price && <span style={errorText}>{errors.extra_price}</span>}
            </div>

            {/* Ratio (SWAP) */}
            {isSwap && (
              <div style={fieldWrap}>
                <label style={fieldLabel}>
                  {t('admin.modifierGroupDetail.modifierForm.field.ratio')}
                </label>
                <input
                  type="number"
                  min={0}
                  step="0.1"
                  style={{ ...fieldInput, ...(errors.ratio ? fieldInputError : {}) }}
                  value={form.ratio}
                  onChange={(e) => setF('ratio', e.target.value)}
                />
                {errors.ratio && <span style={errorText}>{errors.ratio}</span>}
              </div>
            )}

            {/* Supply quantity (ADD) */}
            {!isSwap && (
              <div style={fieldWrap}>
                <label style={fieldLabel}>
                  {t('admin.modifierGroupDetail.modifierForm.field.supplyQty')}
                </label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  style={{ ...fieldInput, ...(errors.supply_quantity ? fieldInputError : {}) }}
                  value={form.supply_quantity}
                  onChange={(e) => setF('supply_quantity', e.target.value)}
                  placeholder="Optional"
                />
                {errors.supply_quantity && (
                  <span style={errorText}>{errors.supply_quantity}</span>
                )}
              </div>
            )}

            {/* Supply unit (ADD) */}
            {!isSwap && (
              <div style={fieldWrap}>
                <label style={fieldLabel}>
                  {t('admin.modifierGroupDetail.modifierForm.field.supplyUnit')}
                </label>
                <input
                  style={fieldInput}
                  value={form.supply_unit}
                  onChange={(e) => setF('supply_unit', e.target.value)}
                  placeholder="ml, g, oz..."
                />
              </div>
            )}

            {/* Display order */}
            <div style={fieldWrap}>
              <label style={fieldLabel}>
                {t('admin.modifierGroupDetail.modifierForm.field.displayOrder')}
              </label>
              <input
                type="number"
                min={0}
                style={{ ...fieldInput, ...(errors.display_order ? fieldInputError : {}) }}
                value={form.display_order}
                onChange={(e) => setF('display_order', e.target.value)}
              />
              {errors.display_order && (
                <span style={errorText}>{errors.display_order}</span>
              )}
            </div>
          </div>

          {/* Toggles row */}
          <div style={toggleRow}>
            {/* Is Default (SWAP only) */}
            {isSwap && (
              <label style={checkboxLabel}>
                <input
                  type="checkbox"
                  checked={form.is_default}
                  onChange={(e) => setF('is_default', e.target.checked)}
                  style={checkboxInput}
                />
                {t('admin.modifierGroupDetail.modifierForm.field.isDefault')}
              </label>
            )}

            {/* Active */}
            <label style={checkboxLabel}>
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) => setF('active', e.target.checked)}
                style={checkboxInput}
              />
              {t('admin.modifierGroupDetail.modifierForm.field.active')}
            </label>
          </div>
        </div>

        {/* Modal footer */}
        <div style={modalFooter}>
          <button type="button" style={btnGhostSm} onClick={onClose} disabled={isPending}>
            {t('common.cancel')}
          </button>
          <button type="button" style={btnPrimarySm} onClick={onSubmit} disabled={isPending}>
            {isPending ? (
              <Spinner size={14} />
            ) : isEdit ? (
              t('common.save')
            ) : (
              t('admin.modifierGroupDetail.addModifier')
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Styles ────────────────────────────────────────────────────────────── */

const spinnerWrap: CSSProperties = {
  padding: 48,
  display: 'flex',
  justifyContent: 'center',
};

const emptyWrap: CSSProperties = {
  padding: '64px 24px',
  textAlign: 'center',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  alignItems: 'center',
};

const emptyTitle: CSSProperties = {
  fontFamily: "'Playfair Display', serif",
  fontSize: 16,
  color: 'var(--text2)',
  margin: 0,
};

const emptyHint: CSSProperties = {
  fontSize: 12,
  color: 'var(--text3)',
  margin: 0,
};

const headerBadges: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
};

const typePill: CSSProperties = {
  display: 'inline-block',
  padding: '4px 10px',
  borderRadius: 999,
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
};

const typePillSwap: CSSProperties = {
  background: 'rgba(201,164,92,0.14)',
  color: '#8a6d2a',
  border: '1px solid rgba(201,164,92,0.35)',
};

const typePillAdd: CSSProperties = {
  background: 'rgba(42,106,200,0.10)',
  color: '#2a6ac8',
  border: '1px solid rgba(42,106,200,0.30)',
};

const modCountBadge: CSSProperties = {
  fontSize: 11,
  color: 'var(--text3)',
  fontWeight: 500,
};

const topRow: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  marginBottom: 10,
};

const groupNameDisplay: CSSProperties = {
  fontFamily: "'Playfair Display', serif",
  fontSize: 22,
  fontWeight: 600,
  color: 'var(--text1)',
  margin: 0,
};

const btnDanger: CSSProperties = {
  padding: '0 16px',
  height: 38,
  borderRadius: 8,
  border: '1px solid rgba(196,80,64,0.30)',
  background: 'transparent',
  color: 'var(--red)',
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
  fontFamily: 'inherit',
};

const btnDangerSm: CSSProperties = {
  padding: '0 14px',
  height: 34,
  borderRadius: 8,
  border: '1px solid var(--red)',
  background: 'var(--red)',
  color: '#fff',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'inherit',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
};

const formCard: CSSProperties = {
  background: 'var(--bg2)',
  border: '1px solid var(--border)',
  borderRadius: 12,
  padding: '18px 20px',
  marginBottom: 16,
};

const formGrid: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: '12px 16px',
  marginTop: 12,
};

const fieldWrap: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
};

const fieldLabel: CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--text3)',
};

const fieldInput: CSSProperties = {
  height: 40,
  padding: '0 12px',
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'var(--bg)',
  color: 'var(--text1)',
  fontSize: 14,
  fontFamily: 'inherit',
  outline: 'none',
  minHeight: 44,
};

const fieldInputError: CSSProperties = {
  borderColor: 'var(--red)',
};

const errorText: CSSProperties = {
  fontSize: 11,
  color: 'var(--red)',
  fontWeight: 500,
};

const pillRow: CSSProperties = {
  display: 'inline-flex',
  gap: 4,
};

const pillBtn: CSSProperties = {
  padding: '8px 16px',
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'var(--bg)',
  color: 'var(--text2)',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'inherit',
  minHeight: 44,
};

const pillBtnActive: CSSProperties = {
  background: 'var(--text1)',
  color: '#fff',
  borderColor: 'var(--text1)',
};

const section: CSSProperties = {
  marginTop: 14,
  marginBottom: 18,
};

const sectionHead: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  marginBottom: 10,
  gap: 12,
};

const sectionTitle: CSSProperties = {
  fontFamily: "'Playfair Display', serif",
  fontSize: 17,
  fontWeight: 600,
  color: 'var(--text1)',
  margin: 0,
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
};

const sectionCount: CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--text3)',
  background: 'var(--bg)',
  border: '1px solid var(--border)',
  padding: '2px 9px',
  borderRadius: 999,
};

const btnPrimarySm: CSSProperties = {
  padding: '0 14px',
  height: 34,
  borderRadius: 8,
  border: '1px solid var(--text1)',
  background: 'var(--text1)',
  color: '#fff',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'inherit',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
};

const btnGhostSm: CSSProperties = {
  padding: '0 10px',
  height: 30,
  borderRadius: 6,
  border: '1px solid var(--border)',
  background: 'var(--bg2)',
  color: 'var(--text1)',
  fontSize: 12,
  fontWeight: 500,
  cursor: 'pointer',
  fontFamily: 'inherit',
};

const tableShell: CSSProperties = {
  background: 'var(--bg2)',
  border: '1px solid var(--border)',
  borderRadius: 12,
  overflow: 'hidden',
};

const tableHead: CSSProperties = {
  display: 'grid',
  padding: '12px 20px',
  fontSize: 10,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: 'var(--text3)',
  fontWeight: 700,
  background: 'var(--bg)',
  borderBottom: '1px solid var(--border)',
  gap: 14,
  alignItems: 'center',
};

const tableRow: CSSProperties = {
  display: 'grid',
  padding: '12px 20px',
  borderTop: '1px solid var(--border)',
  gap: 14,
  alignItems: 'center',
  fontSize: 13,
  color: 'var(--text1)',
  minHeight: 48,
};

const cellNum: CSSProperties = {
  textAlign: 'right',
  fontVariantNumeric: 'tabular-nums',
  fontFamily: "'Playfair Display', serif",
  fontWeight: 600,
  fontSize: 14,
};

const cellNumHead: CSSProperties = {
  textAlign: 'right',
};

const nameCell: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  minWidth: 0,
};

const nameMain: CSSProperties = {
  fontWeight: 600,
  color: 'var(--text1)',
  fontSize: 13.5,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const nameSub: CSSProperties = {
  fontSize: 11,
  color: 'var(--text3)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const actionsCell: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
  gap: 6,
};

const emptyRow: CSSProperties = {
  padding: '36px 20px',
  textAlign: 'center',
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  alignItems: 'center',
};

const statusBadge: CSSProperties = {
  display: 'inline-block',
  padding: '4px 10px',
  borderRadius: 999,
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
};

const statusOk: CSSProperties = {
  background: 'rgba(74,140,92,0.12)',
  color: 'var(--green)',
  border: '1px solid rgba(74,140,92,0.30)',
};

const statusOff: CSSProperties = {
  background: 'rgba(168,152,136,0.16)',
  color: 'var(--text2)',
  border: '1px solid rgba(168,152,136,0.36)',
};

const defaultDot: CSSProperties = {
  background: 'none',
  border: 'none',
  fontSize: 18,
  color: 'var(--text3)',
  cursor: 'pointer',
  padding: '4px 8px',
  borderRadius: 6,
  minHeight: 44,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontFamily: 'inherit',
};

const defaultDotActive: CSSProperties = {
  ...defaultDot,
  color: 'var(--gold)',
};

const linkedRow: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '12px 20px',
  borderTop: '1px solid var(--border)',
  minHeight: 48,
};

const linkedTypePill: CSSProperties = {
  display: 'inline-block',
  padding: '3px 8px',
  borderRadius: 999,
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.10em',
  textTransform: 'uppercase',
};

/* ── Confirm dialog ────────────────────────────────────────────────────── */

const scrimStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(44,36,32,0.42)',
  zIndex: 60,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const confirmCard: CSSProperties = {
  background: 'var(--bg2)',
  borderRadius: 14,
  boxShadow: '0 24px 64px rgba(0,0,0,0.32)',
  border: '1px solid var(--border)',
  padding: '24px 28px',
  maxWidth: 400,
  width: '90vw',
};

const confirmText: CSSProperties = {
  fontSize: 14,
  color: 'var(--text1)',
  lineHeight: 1.5,
  margin: '0 0 16px 0',
};

const confirmActions: CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 8,
};

/* ── Modal ─────────────────────────────────────────────────────────────── */

const modalCard: CSSProperties = {
  background: 'var(--bg2)',
  borderRadius: 16,
  boxShadow: '0 24px 64px rgba(0,0,0,0.32)',
  border: '1px solid var(--border)',
  width: 520,
  maxWidth: '95vw',
  maxHeight: '88vh',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
};

const modalHead: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '18px 24px 14px',
  borderBottom: '1px solid var(--border)',
  flexShrink: 0,
};

const modalTitle: CSSProperties = {
  fontFamily: "'Playfair Display', serif",
  fontSize: 18,
  fontWeight: 600,
  color: 'var(--text1)',
  margin: 0,
};

const modalClose: CSSProperties = {
  width: 30,
  height: 30,
  borderRadius: 6,
  border: 'none',
  background: 'transparent',
  color: 'var(--text3)',
  fontSize: 16,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const modalBody: CSSProperties = {
  padding: '20px 24px',
  overflowY: 'auto',
  flex: 1,
};

const modalFooter: CSSProperties = {
  padding: '14px 24px',
  borderTop: '1px solid var(--border)',
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 8,
  flexShrink: 0,
};

const toggleRow: CSSProperties = {
  display: 'flex',
  gap: 20,
  marginTop: 14,
};

const checkboxLabel: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  fontSize: 13,
  color: 'var(--text1)',
  cursor: 'pointer',
  userSelect: 'none',
  minHeight: 44,
};

const checkboxInput: CSSProperties = {
  width: 18,
  height: 18,
  accentColor: 'var(--gold)',
};
