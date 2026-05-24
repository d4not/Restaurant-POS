import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createOrder, type ActiveOrder } from '../api/orders';
import { ApiError } from '../api/client';
import { fetchAllEmployees, type EmployeeSummary } from '../api/employees';
import type { CashRegisterRow } from '../api/registers';
import { useTranslation } from '../i18n';
import { useUi } from '../store/ui';
import { formatMoney } from '../utils/format';
import { Spinner } from './Spinner';
import { IconClock, IconPlus } from './Icons';

interface Props {
  zoneName: string;
  employeeOrders: ActiveOrder[];
  register: CashRegisterRow | null;
  onRefetchRegister: () => void;
}

const timePillStyle = (variant: 'green' | 'gold' | 'red'): React.CSSProperties => {
  const map = {
    green: { bg: 'rgba(74,140,92,0.12)', col: 'var(--green)' },
    gold:  { bg: 'rgba(201,164,92,0.16)', col: '#8a6d2a' },
    red:   { bg: 'rgba(196,80,64,0.12)', col: 'var(--red)' },
  } as const;
  const c = map[variant];
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    padding: '4px 9px',
    borderRadius: 999,
    background: c.bg,
    color: c.col,
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: '0.06em',
    fontVariantNumeric: 'tabular-nums',
  };
};

const empBtnStyle = (selected: boolean): React.CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  width: '100%',
  padding: '12px 14px',
  borderRadius: 8,
  border: `1px solid ${selected ? 'var(--gold)' : 'var(--border)'}`,
  background: selected ? 'rgba(201,164,92,0.10)' : 'var(--bg)',
  cursor: 'pointer',
  fontFamily: 'inherit',
  color: 'var(--text1)',
  marginBottom: 8,
  textAlign: 'left',
});

const confirmBtnStyle = (disabled: boolean): React.CSSProperties => ({
  padding: '10px 18px',
  background: 'var(--text1)',
  color: '#fff',
  border: 'none',
  borderRadius: 8,
  fontSize: 13,
  fontWeight: 600,
  cursor: disabled ? 'not-allowed' : 'pointer',
  opacity: disabled ? 0.5 : 1,
  fontFamily: 'inherit',
});

const styles: Record<string, React.CSSProperties> = {
  root: {
    flex: 1,
    minHeight: 0,
    padding: '20px 28px 24px',
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
    overflow: 'auto',
  },
  toolbar: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
  },
  newBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    padding: '12px 18px',
    borderRadius: 10,
    background: 'var(--gold)',
    color: '#2c2420',
    fontSize: 14,
    fontWeight: 700,
    cursor: 'pointer',
    border: '1px solid rgba(44,36,32,0.08)',
    fontFamily: 'inherit',
    minHeight: 44,
  },
  newBtnDisabled: { opacity: 0.55, cursor: 'not-allowed' },
  hint: { fontSize: 12, color: 'var(--text2)' },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
    gap: 14,
  },
  card: {
    background: 'var(--bg2)',
    border: '1px solid var(--border)',
    borderRadius: 12,
    padding: '14px 16px',
    boxShadow: 'var(--shadow-sm)',
    cursor: 'pointer',
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    transition: 'transform 0.1s, box-shadow 0.1s',
  },
  cardTopRow: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' },
  cardOrder: { fontFamily: "'Playfair Display', serif", fontSize: 20, fontWeight: 700, color: 'var(--text1)' },
  cardSub: { fontSize: 11, color: 'var(--text3)', letterSpacing: '0.06em', textTransform: 'uppercase', fontWeight: 600 },
  employeeBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '3px 10px',
    borderRadius: 999,
    background: 'rgba(201,164,92,0.15)',
    border: '1px solid rgba(201,164,92,0.4)',
    fontSize: 12,
    fontWeight: 600,
    color: '#8a6d2a',
  },
  meta: { display: 'flex', flexDirection: 'column', gap: 3, fontSize: 12, color: 'var(--text2)' },
  total: {
    fontFamily: "'Playfair Display', serif",
    fontSize: 20,
    fontWeight: 700,
    color: 'var(--text1)',
    marginTop: 4,
  },
  empty: {
    padding: '60px 24px',
    textAlign: 'center',
    color: 'var(--text3)',
    fontSize: 14,
  },
  emptyIcon: { fontSize: 32, marginBottom: 10 },
  errorBox: {
    padding: '12px 14px',
    borderRadius: 8,
    background: 'rgba(196,80,64,0.08)',
    border: '1px solid rgba(196,80,64,0.25)',
    color: 'var(--red)',
    fontSize: 13,
  },

  // Employee picker modal
  scrim: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(44,36,32,0.42)',
    zIndex: 80,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modal: {
    width: 480,
    background: 'var(--bg2)',
    borderRadius: 14,
    boxShadow: '0 24px 64px rgba(0,0,0,0.32)',
    border: '1px solid var(--border)',
    overflow: 'hidden',
  },
  modalHead: { padding: '20px 24px 16px', borderBottom: '1px solid var(--border)' },
  modalTitle: { fontFamily: "'Playfair Display', serif", fontSize: 22, fontWeight: 600, margin: 0 },
  modalSub: { fontSize: 12, color: 'var(--text2)', marginTop: 4 },
  modalBody: { padding: '16px 24px', maxHeight: '60vh', overflowY: 'auto' },
  modalActions: {
    padding: '14px 24px',
    borderTop: '1px solid var(--border)',
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 8,
  },
  empName: { fontSize: 14, fontWeight: 600 },
  empRole: {
    fontSize: 10,
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    color: 'var(--text3)',
    fontWeight: 700,
  },
  cancelBtn: {
    padding: '10px 16px',
    background: 'transparent',
    border: '1px solid var(--border)',
    borderRadius: 8,
    color: 'var(--text1)',
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
};

function elapsedMinutes(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
}

function timeVariant(min: number): 'green' | 'gold' | 'red' {
  if (min >= 25) return 'red';
  if (min >= 10) return 'gold';
  return 'green';
}

export function EmployeeZoneView({
  zoneName,
  employeeOrders,
  register,
  onRefetchRegister,
}: Props) {
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  const openOrderDetail = useUi((s) => s.openOrderDetail);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selectedEmpId, setSelectedEmpId] = useState<string>('');

  const employeesQuery = useQuery({
    queryKey: ['employees', 'active'],
    queryFn: fetchAllEmployees,
    enabled: pickerOpen,
    staleTime: 60_000,
  });

  const newMutation = useMutation({
    mutationFn: (employeeUserId: string) => {
      if (!register) {
        return Promise.reject(
          new ApiError('No open shift — open one from the top bar.', 409),
        );
      }
      return createOrder({
        register_id: register.id,
        order_type: 'EMPLOYEE',
        employee_user_id: employeeUserId,
      });
    },
    onSuccess: (order) => {
      setPickerOpen(false);
      setSelectedEmpId('');
      queryClient.invalidateQueries({ queryKey: ['orders', 'active'] });
      openOrderDetail(order.id);
    },
  });

  const sorted = [...employeeOrders].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );

  return (
    <div style={styles.root}>
      <div style={styles.toolbar}>
        <button
          type="button"
          style={{
            ...styles.newBtn,
            ...(newMutation.isPending || !register ? styles.newBtnDisabled : null),
          }}
          onClick={() => {
            if (!register) {
              onRefetchRegister();
              return;
            }
            setPickerOpen(true);
          }}
          disabled={newMutation.isPending}
        >
          <IconPlus />
          <span>
            {newMutation.isPending
              ? t('employeeOrder.opening')
              : t('employeeOrder.newTitle')}
          </span>
        </button>
        <span style={styles.hint}>
          {zoneName} ·{' '}
          {(sorted.length === 1
            ? t('employeeOrder.activeOne')
            : t('employeeOrder.activeMany')
          ).replace('{n}', String(sorted.length))}
        </span>
        {newMutation.isPending && <Spinner size={16} />}
      </div>

      {!register && (
        <div style={styles.errorBox}>{t('employeeOrder.noShift')}</div>
      )}

      {newMutation.error && (
        <div style={styles.errorBox}>
          {newMutation.error instanceof ApiError
            ? newMutation.error.message
            : t('employeeOrder.couldNotStart')}
        </div>
      )}

      {sorted.length === 0 ? (
        <div style={styles.empty}>
          <div style={styles.emptyIcon}>👥</div>
          <div>{t('employeeOrder.zoneEmpty')}</div>
        </div>
      ) : (
        <div style={styles.grid}>
          {sorted.map((order) => {
            const min = elapsedMinutes(order.created_at);
            const variant = timeVariant(min);
            const itemCount = order.items.filter((i) => !i.voided_at).length;
            return (
              <div
                key={order.id}
                style={styles.card}
                onClick={() => openOrderDetail(order.id)}
              >
                <div style={styles.cardTopRow}>
                  <div>
                    <div style={styles.cardOrder}>#{order.order_number}</div>
                    <div style={styles.cardSub}>{t('employeeOrder.label')}</div>
                  </div>
                  <span style={timePillStyle(variant)}>
                    <IconClock style={{ fontSize: 12 }} />
                    {min} min
                  </span>
                </div>
                <span style={styles.employeeBadge}>
                  {order.employee?.name ?? t('employeeOrder.unknown')}
                </span>
                <div style={styles.meta}>
                  <span>
                    {itemCount} {itemCount === 1 ? 'item' : 'items'} · {order.user.name}
                  </span>
                </div>
                <div style={styles.total}>{formatMoney(order.total)}</div>
              </div>
            );
          })}
        </div>
      )}

      {pickerOpen && (
        <div style={styles.scrim} onClick={() => setPickerOpen(false)}>
          <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalHead}>
              <h2 style={styles.modalTitle}>{t('employeeOrder.pickEmployeeTitle')}</h2>
              <div style={styles.modalSub}>{t('employeeOrder.pickEmployeeSub')}</div>
            </div>
            <div style={styles.modalBody}>
              {employeesQuery.isLoading ? (
                <div style={{ textAlign: 'center', padding: 30 }}>
                  <Spinner size={20} />
                </div>
              ) : (
                (employeesQuery.data ?? []).map((emp: EmployeeSummary) => (
                  <button
                    key={emp.id}
                    type="button"
                    style={empBtnStyle(emp.id === selectedEmpId)}
                    onClick={() => setSelectedEmpId(emp.id)}
                  >
                    <span style={styles.empName}>{emp.name}</span>
                    <span style={styles.empRole}>{emp.role}</span>
                  </button>
                ))
              )}
            </div>
            <div style={styles.modalActions}>
              <button
                type="button"
                style={styles.cancelBtn}
                onClick={() => {
                  setPickerOpen(false);
                  setSelectedEmpId('');
                }}
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                style={confirmBtnStyle(!selectedEmpId || newMutation.isPending)}
                disabled={!selectedEmpId || newMutation.isPending}
                onClick={() => selectedEmpId && newMutation.mutate(selectedEmpId)}
              >
                {newMutation.isPending && <Spinner size={12} />}
                {t('employeeOrder.startTab')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
