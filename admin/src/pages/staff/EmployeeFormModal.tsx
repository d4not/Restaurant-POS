import { useEffect, useState } from 'react';
import { Button, Modal } from '../../components/ui';
import { Input } from '../../components/forms/Input';
import { useCreateEmployee, useUpdateEmployee } from '../../hooks/useEmployees';
import type { Employee } from '../../types/staff';
import type { UserRole } from '../../types/api';
import { amountToCentavos, moneyLabel } from '../../utils/format';

interface Props {
  open: boolean;
  onClose: () => void;
  /** When provided, the modal edits this employee instead of creating a new one. */
  employee?: Employee;
}

const ROLES: UserRole[] = ['ADMIN', 'MANAGER', 'CASHIER', 'BARISTA'];

interface FormState {
  name: string;
  email: string;
  pin: string;
  password: string;
  role: UserRole;
  position: string;
  weeklySalary: string;
  hireDate: string;
  phone: string;
  emergencyContact: string;
  notes: string;
}

function emptyState(): FormState {
  return {
    name: '',
    email: '',
    pin: '',
    password: '',
    role: 'CASHIER',
    position: '',
    weeklySalary: '',
    hireDate: '',
    phone: '',
    emergencyContact: '',
    notes: '',
  };
}

function fromEmployee(e: Employee): FormState {
  return {
    name: e.name,
    email: e.email,
    pin: '',
    password: '',
    role: e.role,
    position: e.position ?? '',
    weeklySalary: e.weekly_salary ? (Number(e.weekly_salary) / 100).toFixed(2) : '',
    hireDate: e.hire_date ? e.hire_date.slice(0, 10) : '',
    phone: e.phone ?? '',
    emergencyContact: e.emergency_contact ?? '',
    notes: e.notes ?? '',
  };
}

export function EmployeeFormModal({ open, onClose, employee }: Props) {
  const [state, setState] = useState<FormState>(emptyState());
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<Partial<Record<keyof FormState, string>>>({});

  const createM = useCreateEmployee();
  const updateM = useUpdateEmployee();
  const isEdit = !!employee;

  useEffect(() => {
    if (!open) return;
    setState(employee ? fromEmployee(employee) : emptyState());
    setError(null);
    setFieldError({});
  }, [open, employee]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setState((s) => ({ ...s, [key]: value }));

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setError(null);
    const errs: typeof fieldError = {};

    if (!state.name.trim()) errs.name = 'Required';
    if (!state.email.trim()) errs.email = 'Required';
    if (!isEdit) {
      if (!/^\d{4,6}$/.test(state.pin)) errs.pin = '4–6 digits';
      if (state.password.length < 6) errs.password = 'Min 6 chars';
    } else {
      if (state.pin && !/^\d{4,6}$/.test(state.pin)) errs.pin = '4–6 digits';
      if (state.password && state.password.length < 6) errs.password = 'Min 6 chars';
    }
    const salaryCents = amountToCentavos(state.weeklySalary);
    if (salaryCents === null) errs.weeklySalary = 'Enter a non-negative amount';

    if (Object.keys(errs).length > 0) {
      setFieldError(errs);
      return;
    }
    setFieldError({});

    try {
      if (isEdit && employee) {
        await updateM.mutateAsync({
          id: employee.id,
          input: {
            name: state.name.trim(),
            email: state.email.trim(),
            ...(state.pin ? { pin: state.pin } : {}),
            ...(state.password ? { password: state.password } : {}),
            role: state.role,
            weekly_salary: salaryCents,
            hire_date: state.hireDate || null,
            position: state.position.trim() || null,
            phone: state.phone.trim() || null,
            emergency_contact: state.emergencyContact.trim() || null,
            notes: state.notes.trim() || null,
          },
        });
      } else {
        await createM.mutateAsync({
          name: state.name.trim(),
          email: state.email.trim(),
          pin: state.pin,
          password: state.password,
          role: state.role,
          weekly_salary: salaryCents ?? 0,
          hire_date: state.hireDate || undefined,
          position: state.position.trim() || undefined,
          phone: state.phone.trim() || undefined,
          emergency_contact: state.emergencyContact.trim() || undefined,
          notes: state.notes.trim() || undefined,
        });
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save employee');
    }
  };

  const pending = createM.isPending || updateM.isPending;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? `Edit ${employee!.name}` : 'New employee'}
      closeOnOverlay={!pending}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant="primary" loading={pending} onClick={submit}>
            {isEdit ? 'Save changes' : 'Create employee'}
          </Button>
        </>
      }
    >
      <form onSubmit={submit}>
        {error && (
          <div className="auth-alert" style={{ marginBottom: 12 }}>
            {error}
          </div>
        )}

        <div className="form-grid-2">
          <Input
            label="Full name"
            name="name"
            autoFocus
            value={state.name}
            onChange={(e) => set('name', e.target.value)}
            error={fieldError.name}
          />
          <Input
            label="Email"
            name="email"
            type="email"
            value={state.email}
            onChange={(e) => set('email', e.target.value)}
            error={fieldError.email}
          />
        </div>

        <div className="form-grid-2">
          <Input
            label={isEdit ? 'PIN (leave blank to keep)' : 'POS PIN (4–6 digits)'}
            name="pin"
            inputMode="numeric"
            value={state.pin}
            onChange={(e) => set('pin', e.target.value.replace(/\D/g, ''))}
            error={fieldError.pin}
            maxLength={6}
          />
          <Input
            label={isEdit ? 'Password (leave blank to keep)' : 'Password'}
            name="password"
            type="password"
            value={state.password}
            onChange={(e) => set('password', e.target.value)}
            error={fieldError.password}
          />
        </div>

        <div className="form-grid-2">
          <div className="field">
            <label htmlFor="role">Role</label>
            <select
              id="role"
              value={state.role}
              onChange={(e) => set('role', e.target.value as UserRole)}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>
          <Input
            label="Position"
            name="position"
            value={state.position}
            onChange={(e) => set('position', e.target.value)}
            placeholder="Barista, Cashier, Manager…"
          />
        </div>

        <div className="form-grid-2">
          <Input
            label={moneyLabel('Weekly salary')}
            name="weeklySalary"
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            value={state.weeklySalary}
            onChange={(e) => set('weeklySalary', e.target.value)}
            error={fieldError.weeklySalary}
            placeholder="2500.00"
          />
          <Input
            label="Hire date"
            name="hireDate"
            type="date"
            value={state.hireDate}
            onChange={(e) => set('hireDate', e.target.value)}
          />
        </div>

        <div className="form-grid-2">
          <Input
            label="Phone"
            name="phone"
            value={state.phone}
            onChange={(e) => set('phone', e.target.value)}
          />
          <Input
            label="Emergency contact"
            name="emergency"
            value={state.emergencyContact}
            onChange={(e) => set('emergencyContact', e.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="notes">Notes</label>
          <textarea
            id="notes"
            value={state.notes}
            onChange={(e) => set('notes', e.target.value)}
            maxLength={2000}
          />
        </div>
      </form>
    </Modal>
  );
}
