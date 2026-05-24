// Cashier-facing "Hacer mandado" wizard. Lives in the Operations Hub.
//
// Two screens, swapped via a local mode flag:
//   • LIST    — active errands attached to the current shift + "+ Nuevo mandado".
//               Each active row is tappable → drops into RETURN for that errand.
//   • CREATE  — pick supplier + supplies + runner + cash → POST /purchases
//               then POST /:id/dispatch, all wrapped in one operator action.
//   • RETURN  — for a DISPATCHED row, capture received quantities + change →
//               POST /:id/return. Stock isn't absorbed yet; that's manager+
//               via Admin Mode.
//
// Why two-screen vs three modals: the cashier's day rotates dispatch → wait →
// runner returns → next mandado. Keeping it all in one hub card means they
// never lose the thread; opening a fresh modal per step forces context.

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { listSuppliers, type Supplier } from '../../api/suppliers';
import { listStorages, type Storage } from '../../api/storages';
import { fetchAllEmployees, type EmployeeSummary } from '../../api/employees';
import {
  createPurchase,
  dispatchPurchase,
  listPurchases,
  returnPurchase,
  type PurchaseDetail,
} from '../../api/purchases';
import { ApiError } from '../../api/client';
import { Spinner } from '../Spinner';
import { useTranslation } from '../../i18n';
import { useSession } from '../../store/session';
import { hubStyles } from './styles';
import { IconTrash } from './HubIcons';
import { SupplyScanPicker, type SupplyPicked } from './SupplyScanPicker';

interface Props {
  open: boolean;
  onClose: () => void;
  registerId: string | null;
}

interface DraftLine {
  key: string;
  supplyId: string;
  supplyName: string;
  unit: string;
  // Pesos as string so the input is editable; converted to centavos on submit.
  pricePerPackage: string;
  packageQuantity: number;
}

type Mode = 'list' | 'create' | 'return';

function fmtMoneyCentavos(c: number): string {
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(c / 100);
}

// Active = anywhere between DISPATCHED and RETURNED. Once RETURNED the
// cashier's part is done; manager+ takes it from there in Admin Mode.
function isActiveErrand(p: PurchaseDetail): boolean {
  return p.kind === 'ERRAND' && (p.status === 'DISPATCHED' || p.status === 'RETURNED');
}

export function ErrandModal({ open, onClose, registerId }: Props) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const userId = useSession((s) => s.user?.id ?? null);

  const [mode, setMode] = useState<Mode>('list');
  const [returnTargetId, setReturnTargetId] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setMode('list');
      setReturnTargetId(null);
      setServerError(null);
    }
  }, [open]);

  // Active errands attached to the current shift. Filtered to ERRAND kind so
  // a delivery DISPATCHED-by-accident never shows up here.
  const activeQuery = useQuery({
    queryKey: ['purchases', 'errands', 'active'],
    queryFn: () => listPurchases({ kind: 'ERRAND', status: 'DISPATCHED', limit: 50 }),
    enabled: open,
    staleTime: 10_000,
  });
  const active = useMemo(
    () => (activeQuery.data ?? []).filter(isActiveErrand),
    [activeQuery.data],
  );

  // ─── CREATE state ────────────────────────────────────────────────────────
  const suppliersQuery = useQuery({
    queryKey: ['suppliers'],
    queryFn: () => listSuppliers({ active: true }),
    enabled: open && mode === 'create',
  });
  const storagesQuery = useQuery({
    queryKey: ['storages'],
    queryFn: () => listStorages(),
    enabled: open && mode === 'create',
  });
  const employeesQuery = useQuery({
    queryKey: ['employees', 'active'],
    queryFn: () => fetchAllEmployees(),
    enabled: open && mode === 'create',
  });

  const errandSuppliers = useMemo(
    () =>
      (suppliersQuery.data ?? []).filter(
        (s: Supplier) => s.kind === 'ERRAND' || s.kind === 'BOTH' || !s.kind,
      ),
    [suppliersQuery.data],
  );

  const [supplierId, setSupplierId] = useState('');
  const [storageId, setStorageId] = useState('');
  const [runnerId, setRunnerId] = useState('');
  const [cashPesos, setCashPesos] = useState('');
  const [reason, setReason] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([]);

  function resetCreate() {
    setSupplierId('');
    setStorageId('');
    setRunnerId('');
    setCashPesos('');
    setReason('');
    setLines([]);
  }

  function addSupply(s: SupplyPicked) {
    if (lines.some((l) => l.supplyId === s.id)) return;
    setLines((prev) => [
      ...prev,
      {
        key: `${s.id}-${Date.now()}`,
        supplyId: s.id,
        supplyName: s.name,
        unit: s.unit,
        pricePerPackage: '',
        packageQuantity: 1,
      },
    ]);
  }

  function updateLine(key: string, patch: Partial<DraftLine>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function removeLine(key: string) {
    setLines((prev) => prev.filter((l) => l.key !== key));
  }

  const estimatedTotalCentavos = useMemo(
    () =>
      lines.reduce((sum, l) => {
        const price = Number(l.pricePerPackage);
        if (!Number.isFinite(price) || price <= 0) return sum;
        return sum + Math.round(price * 100) * l.packageQuantity;
      }, 0),
    [lines],
  );

  // Auto-suggest cash = estimated * 1.10, rounded to next 100c (= $1) so the
  // operator hands out round bills. Re-suggested whenever lines change while
  // the cashier hasn't typed an override.
  const [cashTouched, setCashTouched] = useState(false);
  useEffect(() => {
    if (cashTouched || estimatedTotalCentavos === 0) return;
    const suggested = Math.ceil((estimatedTotalCentavos * 1.1) / 100) * 100;
    setCashPesos((suggested / 100).toFixed(2));
  }, [estimatedTotalCentavos, cashTouched]);

  const createMutation = useMutation({
    mutationFn: async () => {
      // Two-step: create draft + dispatch. We don't return the intermediate
      // draft so the caller can't get stuck with a half-flow; if dispatch
      // fails the draft sticks around in DRAFT and the operator can resume
      // from Admin Mode.
      const draft = await createPurchase({
        supplier_id: supplierId,
        storage_id: storageId,
        date: new Date().toISOString(),
        kind: 'ERRAND',
        items: lines.map((l) => ({
          supply_id: l.supplyId,
          package_quantity: l.packageQuantity,
          price_per_package: Math.round(Number(l.pricePerPackage) * 100),
        })),
      });
      const dispatched = await dispatchPurchase(draft.id, {
        runner_user_id: runnerId,
        cash_advanced: Math.round(Number(cashPesos) * 100),
        reason: reason.trim() || undefined,
      });
      return dispatched;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['purchases'] });
      qc.invalidateQueries({ queryKey: ['register', 'current'] });
      resetCreate();
      setMode('list');
    },
  });

  // ─── RETURN state ────────────────────────────────────────────────────────
  const returnPurchaseRow = useMemo(
    () => active.find((p) => p.id === returnTargetId) ?? null,
    [active, returnTargetId],
  );
  const [returnRows, setReturnRows] = useState<Record<string, number>>({});
  const [returnCashPesos, setReturnCashPesos] = useState('0.00');
  const [returnNote, setReturnNote] = useState('');

  useEffect(() => {
    if (!returnPurchaseRow) return;
    // Default received = ordered for every line. Operator overrides only the
    // shortfalls — keeps the happy path one tap.
    const seed: Record<string, number> = {};
    for (const it of returnPurchaseRow.items ?? []) {
      seed[it.id] = Number(it.package_quantity);
    }
    setReturnRows(seed);
    setReturnCashPesos('0.00');
    setReturnNote('');
  }, [returnPurchaseRow]);

  const returnMutation = useMutation({
    mutationFn: async () => {
      if (!returnPurchaseRow) throw new Error('No errand selected');
      return returnPurchase(returnPurchaseRow.id, {
        cash_returned: Math.round(Number(returnCashPesos) * 100),
        reason: returnNote.trim() || undefined,
        items: Object.entries(returnRows).map(([id, qty]) => ({
          id,
          received_package_quantity: qty,
        })),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['purchases'] });
      qc.invalidateQueries({ queryKey: ['register', 'current'] });
      setMode('list');
      setReturnTargetId(null);
    },
  });

  // ─── Submit handlers ─────────────────────────────────────────────────────
  function submitCreate() {
    setServerError(null);
    const cashCentavos = Math.round(Number(cashPesos) * 100);
    if (!supplierId || !storageId || !runnerId) return;
    if (lines.length === 0 || cashCentavos <= 0) return;
    if (!lines.every((l) => Number(l.pricePerPackage) > 0 && l.packageQuantity > 0)) return;
    createMutation.mutate(undefined, {
      onError: (err) => {
        setServerError(err instanceof ApiError ? err.message : 'Failed to dispatch errand');
      },
    });
  }

  function submitReturn() {
    setServerError(null);
    const advanced = Number(returnPurchaseRow?.cash_advanced ?? 0);
    const change = Math.round(Number(returnCashPesos) * 100);
    if (change < 0 || change > advanced) return;
    returnMutation.mutate(undefined, {
      onError: (err) => {
        setServerError(err instanceof ApiError ? err.message : 'Failed to record return');
      },
    });
  }

  if (!open) return null;
  if (!registerId) {
    // Belt-and-braces — the hub already disables the card when no shift is
    // open, but the modal can race with shift close. Render a friendly
    // "no shift" view so the cashier sees what happened.
    return (
      <div style={hubStyles.childScrim} onClick={onClose}>
        <div
          style={hubStyles.wideChildModal}
          onClick={(e) => e.stopPropagation()}
          role="dialog"
        >
          <div style={hubStyles.head}>
            <h2 style={hubStyles.title}>{t('errand.title')}</h2>
            <div style={hubStyles.sub}>{t('hub.disabled.noShift')}</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={hubStyles.childScrim} onClick={onClose}>
      <div
        style={hubStyles.wideChildModal}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
      >
        <div style={hubStyles.head}>
          <h2 style={hubStyles.title}>{t('errand.title')}</h2>
          <div style={hubStyles.sub}>
            {mode === 'list'
              ? t('errand.list.sub')
              : mode === 'create'
                ? t('errand.create.sub')
                : t('errand.return.sub')}
          </div>
        </div>

        <div style={hubStyles.body}>
          {serverError && (
            <div
              style={{
                color: 'var(--red)',
                background: 'rgba(196,80,64,0.06)',
                border: '1px solid rgba(196,80,64,0.2)',
                borderRadius: 8,
                padding: '8px 12px',
                marginBottom: 12,
                fontSize: 13,
              }}
            >
              {serverError}
            </div>
          )}

          {mode === 'list' && (
            <ListMode
              active={active}
              loading={activeQuery.isLoading}
              onOpenCreate={() => setMode('create')}
              onPickActive={(id) => {
                setReturnTargetId(id);
                setMode('return');
              }}
            />
          )}

          {mode === 'create' && (
            <CreateMode
              suppliers={errandSuppliers}
              storages={storagesQuery.data ?? []}
              employees={(employeesQuery.data ?? []).filter((e) => e.id !== userId)}
              supplierId={supplierId}
              storageId={storageId}
              runnerId={runnerId}
              cashPesos={cashPesos}
              reason={reason}
              lines={lines}
              estimatedTotalCentavos={estimatedTotalCentavos}
              onSetSupplier={setSupplierId}
              onSetStorage={setStorageId}
              onSetRunner={setRunnerId}
              onSetCash={(v) => {
                setCashTouched(true);
                setCashPesos(v);
              }}
              onSetReason={setReason}
              addSupply={addSupply}
              updateLine={updateLine}
              removeLine={removeLine}
              onBack={() => {
                setMode('list');
                resetCreate();
              }}
              onSubmit={submitCreate}
              pending={createMutation.isPending}
            />
          )}

          {mode === 'return' && returnPurchaseRow && (
            <ReturnMode
              purchase={returnPurchaseRow}
              rows={returnRows}
              setRows={setReturnRows}
              cashPesos={returnCashPesos}
              setCashPesos={setReturnCashPesos}
              note={returnNote}
              setNote={setReturnNote}
              onBack={() => {
                setMode('list');
                setReturnTargetId(null);
              }}
              onSubmit={submitReturn}
              pending={returnMutation.isPending}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Sub-views — kept inline to avoid a sub-folder for one feature.

function ListMode({
  active,
  loading,
  onOpenCreate,
  onPickActive,
}: {
  active: PurchaseDetail[];
  loading: boolean;
  onOpenCreate: () => void;
  onPickActive: (id: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <div
        style={{
          background: 'var(--bg)',
          border: '1px solid var(--border)',
          borderRadius: 10,
          padding: 12,
          marginBottom: 14,
        }}
      >
        <div style={{ fontSize: 11, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 600, marginBottom: 8 }}>
          {t('errand.list.active')}
        </div>
        {loading && (
          <div style={{ padding: 12, color: 'var(--text2)', fontSize: 13 }}>
            <Spinner size={14} /> {t('common.loading')}
          </div>
        )}
        {!loading && active.length === 0 && (
          <div style={{ color: 'var(--text3)', fontSize: 13, padding: 8 }}>
            {t('errand.list.empty')}
          </div>
        )}
        {active.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => onPickActive(p.id)}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              width: '100%',
              padding: '10px 12px',
              background: 'var(--bg2)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              marginTop: 6,
              cursor: 'pointer',
              textAlign: 'left',
            }}
          >
            <div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>
                {p.supplier?.name ?? '—'} · {p.runner?.name ?? '—'}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>
                {fmtMoneyCentavos(Number(p.cash_advanced ?? 0))}{' '}
                {t('errand.list.advanced')} ·{' '}
                {p.dispatched_at ? new Date(p.dispatched_at).toLocaleTimeString() : ''}
              </div>
            </div>
            <div style={{ fontSize: 13, color: 'var(--gold)', fontWeight: 600 }}>
              {t('errand.list.markReturned')} →
            </div>
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={onOpenCreate}
        style={{
          width: '100%',
          padding: '14px 18px',
          background: 'var(--gold)',
          color: '#2c2420',
          border: 'none',
          borderRadius: 10,
          fontSize: 15,
          fontWeight: 600,
          cursor: 'pointer',
          minHeight: 52,
        }}
      >
        + {t('errand.create.cta')}
      </button>
    </>
  );
}

function CreateMode({
  suppliers,
  storages,
  employees,
  supplierId,
  storageId,
  runnerId,
  cashPesos,
  reason,
  lines,
  estimatedTotalCentavos,
  onSetSupplier,
  onSetStorage,
  onSetRunner,
  onSetCash,
  onSetReason,
  addSupply,
  updateLine,
  removeLine,
  onBack,
  onSubmit,
  pending,
}: {
  suppliers: Supplier[];
  storages: Storage[];
  employees: EmployeeSummary[];
  supplierId: string;
  storageId: string;
  runnerId: string;
  cashPesos: string;
  reason: string;
  lines: DraftLine[];
  estimatedTotalCentavos: number;
  onSetSupplier: (v: string) => void;
  onSetStorage: (v: string) => void;
  onSetRunner: (v: string) => void;
  onSetCash: (v: string) => void;
  onSetReason: (v: string) => void;
  addSupply: (s: SupplyPicked) => void;
  updateLine: (key: string, patch: Partial<DraftLine>) => void;
  removeLine: (key: string) => void;
  onBack: () => void;
  onSubmit: () => void;
  pending: boolean;
}) {
  const { t } = useTranslation();
  const hideIds = useMemo(() => new Set(lines.map((l) => l.supplyId)), [lines]);
  const canSubmit =
    !!supplierId &&
    !!storageId &&
    !!runnerId &&
    lines.length > 0 &&
    lines.every((l) => Number(l.pricePerPackage) > 0 && l.packageQuantity > 0) &&
    Number(cashPesos) > 0;
  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
        <div style={hubStyles.field}>
          <label style={hubStyles.label}>{t('errand.field.supplier')}</label>
          <select
            style={hubStyles.select}
            value={supplierId}
            onChange={(e) => onSetSupplier(e.target.value)}
          >
            <option value="">—</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div style={hubStyles.field}>
          <label style={hubStyles.label}>{t('errand.field.storage')}</label>
          <select
            style={hubStyles.select}
            value={storageId}
            onChange={(e) => onSetStorage(e.target.value)}
          >
            <option value="">—</option>
            {storages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <SupplyScanPicker
        active
        enabled={!!supplierId && !!storageId}
        disabledReason={t('errand.create.pickSupplierFirst')}
        onPick={addSupply}
        hideIds={hideIds}
      />
      <div style={hubStyles.hint}>{t('errand.create.supplyHint')}</div>

      {lines.length > 0 && (
        <div
          style={{
            background: 'var(--bg2)',
            border: '1px solid var(--border)',
            borderRadius: 10,
            marginTop: 12,
            overflow: 'hidden',
          }}
        >
          {lines.map((l, idx) => (
            <div
              key={l.key}
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 100px 130px 36px',
                gap: 10,
                padding: '10px 14px',
                borderBottom: idx === lines.length - 1 ? 'none' : '1px solid var(--border)',
                alignItems: 'center',
              }}
            >
              <div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{l.supplyName}</div>
                <div style={{ fontSize: 11, color: 'var(--text3)' }}>{l.unit}</div>
              </div>
              <input
                type="number"
                min={1}
                step={1}
                value={l.packageQuantity}
                onChange={(e) => updateLine(l.key, { packageQuantity: Number(e.target.value) || 1 })}
                style={{ ...hubStyles.input, textAlign: 'right' }}
              />
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder="$ por paquete"
                value={l.pricePerPackage}
                onChange={(e) => updateLine(l.key, { pricePerPackage: e.target.value })}
                style={{ ...hubStyles.input, textAlign: 'right' }}
              />
              <button
                type="button"
                onClick={() => removeLine(l.key)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--red)',
                  cursor: 'pointer',
                  padding: 4,
                }}
                aria-label="remove"
              >
                <IconTrash width={16} height={16} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 12,
          marginTop: 14,
        }}
      >
        <div style={hubStyles.field}>
          <label style={hubStyles.label}>{t('errand.field.runner')}</label>
          <select
            style={hubStyles.select}
            value={runnerId}
            onChange={(e) => onSetRunner(e.target.value)}
          >
            <option value="">—</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </div>
        <div style={hubStyles.field}>
          <label style={hubStyles.label}>{t('errand.field.cashAdvanced')}</label>
          <input
            type="number"
            min="0"
            step="0.01"
            value={cashPesos}
            onChange={(e) => onSetCash(e.target.value)}
            style={hubStyles.input}
          />
          <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>
            {t('errand.create.estimated')}: {fmtMoneyCentavos(estimatedTotalCentavos)}
          </div>
        </div>
      </div>

      <div style={hubStyles.field}>
        <label style={hubStyles.label}>{t('errand.field.note')}</label>
        <input
          type="text"
          value={reason}
          onChange={(e) => onSetReason(e.target.value)}
          maxLength={120}
          style={hubStyles.input}
        />
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 18, justifyContent: 'flex-end' }}>
        <button
          type="button"
          onClick={onBack}
          style={{ ...hubStyles.cancelBtn, padding: '12px 18px' }}
        >
          ← {t('common.back')}
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={!canSubmit || pending}
          style={{
            background: canSubmit ? 'var(--gold)' : 'var(--border)',
            color: '#2c2420',
            padding: '12px 18px',
            border: 'none',
            borderRadius: 10,
            fontSize: 14,
            fontWeight: 600,
            cursor: canSubmit ? 'pointer' : 'not-allowed',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            minHeight: 44,
          }}
        >
          {pending && <Spinner size={12} />}
          {t('errand.create.submit')}
        </button>
      </div>
    </>
  );
}

function ReturnMode({
  purchase,
  rows,
  setRows,
  cashPesos,
  setCashPesos,
  note,
  setNote,
  onBack,
  onSubmit,
  pending,
}: {
  purchase: PurchaseDetail;
  rows: Record<string, number>;
  setRows: (rows: Record<string, number>) => void;
  cashPesos: string;
  setCashPesos: (v: string) => void;
  note: string;
  setNote: (v: string) => void;
  onBack: () => void;
  onSubmit: () => void;
  pending: boolean;
}) {
  const { t } = useTranslation();
  const advancedCentavos = Number(purchase.cash_advanced ?? 0);
  const changeCentavos = Math.round(Number(cashPesos) * 100);
  const cashValid = changeCentavos >= 0 && changeCentavos <= advancedCentavos;
  return (
    <>
      <div
        style={{
          background: 'var(--bg)',
          border: '1px solid var(--border)',
          borderRadius: 10,
          padding: 12,
          marginBottom: 12,
          display: 'flex',
          justifyContent: 'space-between',
        }}
      >
        <div>
          <div style={{ fontSize: 13 }}>{purchase.supplier?.name ?? '—'}</div>
          <div style={{ fontSize: 11, color: 'var(--text3)' }}>
            {t('errand.return.runner')}: {purchase.runner?.name ?? '—'}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 11, color: 'var(--text3)' }}>
            {t('errand.return.advanced')}
          </div>
          <div
            style={{
              fontFamily: "'Playfair Display', serif",
              fontSize: 18,
              fontWeight: 600,
            }}
          >
            {fmtMoneyCentavos(advancedCentavos)}
          </div>
        </div>
      </div>

      <div
        style={{
          background: 'var(--bg2)',
          border: '1px solid var(--border)',
          borderRadius: 10,
          overflow: 'hidden',
          marginBottom: 12,
        }}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 100px 100px',
            gap: 10,
            padding: '10px 14px',
            fontSize: 10,
            textTransform: 'uppercase',
            letterSpacing: '0.1em',
            color: 'var(--text3)',
            fontWeight: 600,
            borderBottom: '1px solid var(--border)',
            background: 'var(--bg)',
          }}
        >
          <span>{t('errand.return.item')}</span>
          <span style={{ textAlign: 'right' }}>{t('errand.return.ordered')}</span>
          <span style={{ textAlign: 'right' }}>{t('errand.return.received')}</span>
        </div>
        {(purchase.items ?? []).map((it, idx) => (
          <div
            key={it.id}
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 100px 100px',
              gap: 10,
              padding: '10px 14px',
              borderBottom: idx === (purchase.items ?? []).length - 1 ? 'none' : '1px solid var(--border)',
              alignItems: 'center',
              fontSize: 13,
            }}
          >
            <span>{it.supply?.name ?? it.supply_id}</span>
            <span style={{ textAlign: 'right' }}>{Number(it.package_quantity)}</span>
            <input
              type="number"
              min={0}
              step="0.01"
              value={rows[it.id] ?? 0}
              onChange={(e) => setRows({ ...rows, [it.id]: Number(e.target.value) })}
              style={{ ...hubStyles.input, textAlign: 'right' }}
            />
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div style={hubStyles.field}>
          <label style={hubStyles.label}>{t('errand.return.change')}</label>
          <input
            type="number"
            min="0"
            max={(advancedCentavos / 100).toFixed(2)}
            step="0.01"
            value={cashPesos}
            onChange={(e) => setCashPesos(e.target.value)}
            style={hubStyles.input}
          />
          {!cashValid && (
            <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 4 }}>
              {t('errand.return.cashInvalid')}
            </div>
          )}
        </div>
        <div style={hubStyles.field}>
          <label style={hubStyles.label}>{t('errand.field.note')}</label>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={120}
            style={hubStyles.input}
          />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 18, justifyContent: 'flex-end' }}>
        <button
          type="button"
          onClick={onBack}
          style={{ ...hubStyles.cancelBtn, padding: '12px 18px' }}
        >
          ← {t('common.back')}
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={!cashValid || pending}
          style={{
            background: cashValid ? 'var(--green)' : 'var(--border)',
            color: '#fff',
            padding: '12px 18px',
            border: 'none',
            borderRadius: 10,
            fontSize: 14,
            fontWeight: 600,
            cursor: cashValid ? 'pointer' : 'not-allowed',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            minHeight: 44,
          }}
        >
          {pending && <Spinner size={12} />}
          {t('errand.return.submit')}
        </button>
      </div>
    </>
  );
}
