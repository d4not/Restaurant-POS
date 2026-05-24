import { useEffect, useState } from 'react';
import { Modal, Button } from '../../components/ui';
import { Input } from '../../components/forms/Input';
import {
  useCreateSupplier,
  useUpdateSupplier,
} from '../../hooks/useSuppliers';
import { SUPPLIER_KINDS, type Supplier, type SupplierKind } from '../../types/inventory';

interface Props {
  open: boolean;
  onClose: () => void;
  supplier?: Supplier | null;
}

interface FormState {
  name: string;
  contact_name: string;
  phone: string;
  email: string;
  address: string;
  credit_days: string;
  notes: string;
  active: boolean;
  kind: SupplierKind;
  whatsapp_phone: string;
  message_template: string;
}

const EMPTY: FormState = {
  name: '',
  contact_name: '',
  phone: '',
  email: '',
  address: '',
  credit_days: '0',
  notes: '',
  active: true,
  kind: 'DELIVERY',
  whatsapp_phone: '',
  message_template: '',
};

function fromSupplier(s: Supplier): FormState {
  return {
    name: s.name,
    contact_name: s.contact_name ?? '',
    phone: s.phone ?? '',
    email: s.email ?? '',
    address: s.address ?? '',
    credit_days: String(s.credit_days),
    notes: s.notes ?? '',
    active: s.active,
    kind: s.kind ?? 'DELIVERY',
    whatsapp_phone: s.whatsapp_phone ?? '',
    message_template: s.message_template ?? '',
  };
}

export function SupplierFormModal({ open, onClose, supplier }: Props) {
  const isEdit = !!supplier;
  const [form, setForm] = useState<FormState>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);

  const createM = useCreateSupplier();
  const updateM = useUpdateSupplier();

  useEffect(() => {
    if (!open) return;
    setForm(supplier ? fromSupplier(supplier) : EMPTY);
    setErrors({});
    setServerError(null);
  }, [open, supplier]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
  };

  const validate = (): boolean => {
    const e: Record<string, string> = {};
    if (!form.name.trim()) e.name = 'Name is required';
    if (form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      e.email = 'Invalid email';
    }
    const n = Number(form.credit_days);
    if (!Number.isInteger(n) || n < 0 || n > 365) {
      e.credit_days = 'Must be an integer between 0 and 365';
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!validate()) return;
    setServerError(null);

    const payload = {
      name: form.name.trim(),
      contact_name: form.contact_name.trim() || undefined,
      phone: form.phone.trim() || undefined,
      email: form.email.trim() || undefined,
      address: form.address.trim() || undefined,
      credit_days: Number(form.credit_days),
      notes: form.notes.trim() || undefined,
      active: form.active,
      kind: form.kind,
      whatsapp_phone: form.whatsapp_phone.trim() || null,
      message_template: form.message_template.trim() || null,
    };

    try {
      if (isEdit && supplier) {
        await updateM.mutateAsync({ id: supplier.id, input: payload });
      } else {
        await createM.mutateAsync(payload);
      }
      onClose();
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Something went wrong');
    }
  };

  const pending = createM.isPending || updateM.isPending;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? 'Edit supplier' : 'New supplier'}
      closeOnOverlay={!pending}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant="primary" loading={pending} onClick={submit}>
            {isEdit ? 'Save changes' : 'Create supplier'}
          </Button>
        </>
      }
    >
      <form onSubmit={submit}>
        {serverError && (
          <div className="auth-alert" style={{ marginBottom: 12 }}>
            {serverError}
          </div>
        )}
        <Input
          label="Name"
          name="name"
          value={form.name}
          onChange={(e) => set('name', e.target.value)}
          autoFocus
          maxLength={200}
          error={errors.name}
        />
        <div className="section-grid-2">
          <Input
            label="Contact name"
            name="contact_name"
            value={form.contact_name}
            onChange={(e) => set('contact_name', e.target.value)}
            maxLength={200}
          />
          <Input
            label="Phone"
            name="phone"
            value={form.phone}
            onChange={(e) => set('phone', e.target.value)}
            maxLength={40}
          />
        </div>
        <div className="section-grid-2">
          <Input
            label="Email"
            name="email"
            type="email"
            value={form.email}
            onChange={(e) => set('email', e.target.value)}
            maxLength={200}
            error={errors.email}
          />
          <Input
            label="Credit days"
            name="credit_days"
            type="number"
            min="0"
            max="365"
            value={form.credit_days}
            onChange={(e) => set('credit_days', e.target.value)}
            error={errors.credit_days}
          />
        </div>
        <Input
          label="Address"
          name="address"
          value={form.address}
          onChange={(e) => set('address', e.target.value)}
          maxLength={500}
        />
        <div className="field">
          <label htmlFor="notes">Notes</label>
          <textarea
            id="notes"
            name="notes"
            value={form.notes}
            onChange={(e) => set('notes', e.target.value)}
            maxLength={2000}
          />
        </div>
        <div className="section-grid-2">
          <div className="field">
            <label htmlFor="kind">Order channel</label>
            <select
              id="kind"
              name="kind"
              value={form.kind}
              onChange={(e) => set('kind', e.target.value as SupplierKind)}
            >
              {SUPPLIER_KINDS.map((k) => (
                <option key={k} value={k}>
                  {k === 'DELIVERY'
                    ? 'Delivery (WhatsApp / courier)'
                    : k === 'ERRAND'
                      ? 'Errand (local store, runner)'
                      : 'Both'}
                </option>
              ))}
            </select>
          </div>
          <Input
            label="WhatsApp number"
            name="whatsapp_phone"
            value={form.whatsapp_phone}
            onChange={(e) => set('whatsapp_phone', e.target.value)}
            placeholder="525512345678"
            hint="E.164 without leading '+'. Used by the WhatsApp deep link."
            maxLength={32}
            disabled={form.kind === 'ERRAND'}
          />
        </div>
        <div className="field">
          <label htmlFor="message_template">WhatsApp message template (optional)</label>
          <textarea
            id="message_template"
            name="message_template"
            value={form.message_template}
            onChange={(e) => set('message_template', e.target.value)}
            placeholder="Hola {supplier_name}, mi pedido:&#10;{items}&#10;Total estimado: {total}&#10;Fecha estimada: {date}"
            rows={4}
            maxLength={2000}
            disabled={form.kind === 'ERRAND'}
          />
          <small className="text-muted">
            Placeholders: {'{supplier_name}'}, {'{items}'}, {'{total}'}, {'{date}'}
          </small>
        </div>
        <div className="field">
          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="checkbox"
              checked={form.active}
              onChange={(e) => set('active', e.target.checked)}
              style={{ width: 'auto', height: 'auto' }}
            />
            Active
          </label>
        </div>
      </form>
    </Modal>
  );
}
