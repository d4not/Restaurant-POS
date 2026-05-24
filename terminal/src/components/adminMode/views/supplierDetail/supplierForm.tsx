// Shared form primitives for the supplier surface (detail page + create modal
// in SuppliersListView). Extracted from the original drawer-bound inline
// helpers so the InfoTab, the LinkedProductsTab packaging editor, and the
// surviving CreateSupplierModal all share one source of truth.

import type { CSSProperties } from 'react';

export interface FieldTextProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
  placeholder?: string;
  textarea?: boolean;
  fullWidth?: boolean;
  disabled?: boolean;
}

export function FieldText({
  label,
  value,
  onChange,
  type = 'text',
  required,
  placeholder,
  textarea,
  fullWidth,
  disabled,
}: FieldTextProps) {
  return (
    <label
      style={{
        ...fieldStyle,
        gridColumn: fullWidth ? '1 / -1' : undefined,
      }}
    >
      <span style={fieldLabel}>{label}</span>
      {textarea ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          style={{ ...textInputStyle, minHeight: 72, paddingTop: 8 }}
        />
      ) : (
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required={required}
          placeholder={placeholder}
          disabled={disabled}
          style={textInputStyle}
        />
      )}
    </label>
  );
}

export interface FieldNumberProps {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  disabled?: boolean;
}

export function FieldNumber({
  label,
  value,
  onChange,
  min,
  max,
  disabled,
}: FieldNumberProps) {
  return (
    <label style={fieldStyle}>
      <span style={fieldLabel}>{label}</span>
      <input
        type="number"
        inputMode="numeric"
        value={Number.isFinite(value) ? value : 0}
        min={min}
        max={max}
        disabled={disabled}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onChange(n);
        }}
        style={textInputStyle}
      />
    </label>
  );
}

export interface FieldDecimalProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  min?: number;
  step?: string;
  required?: boolean;
  disabled?: boolean;
}

export function FieldDecimal({
  label,
  value,
  onChange,
  min,
  step,
  required,
  disabled,
}: FieldDecimalProps) {
  return (
    <label style={fieldStyle}>
      <span style={fieldLabel}>{label}</span>
      <input
        type="number"
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        min={min}
        step={step}
        required={required}
        disabled={disabled}
        style={textInputStyle}
      />
    </label>
  );
}

// Trim and collapse an empty string to null so the backend's optional fields
// aren't stamped with "". Mirrors the helper that lived inline in
// SuppliersListView.
export function emptyToNull(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const trimmed = v.trim();
  return trimmed === '' ? null : trimmed;
}

// ─── Shared styles ─────────────────────────────────────────────────────────

export const formStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
};

export const formGrid: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gap: 14,
};

export const fieldStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
};

export const fieldLabel: CSSProperties = {
  fontSize: 10,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: 'var(--text3)',
  fontWeight: 700,
};

export const textInputStyle: CSSProperties = {
  height: 38,
  border: '1px solid var(--border)',
  borderRadius: 8,
  background: 'var(--bg2)',
  padding: '0 10px',
  fontSize: 13,
  color: 'var(--text1)',
  fontFamily: 'inherit',
  outline: 'none',
  width: '100%',
};

export const formFooter: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  paddingTop: 4,
};

export const btnPrimary: CSSProperties = {
  padding: '10px 18px',
  borderRadius: 8,
  border: 'none',
  background: 'var(--text1)',
  color: '#fff',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'inherit',
  minHeight: 44,
};

export const btnSecondary: CSSProperties = {
  padding: '10px 16px',
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'var(--bg2)',
  color: 'var(--text1)',
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
  fontFamily: 'inherit',
  minHeight: 44,
};

export const btnDanger: CSSProperties = {
  padding: '10px 16px',
  borderRadius: 8,
  border: '1px solid rgba(196,80,64,0.25)',
  background: 'transparent',
  color: 'var(--red)',
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
  fontFamily: 'inherit',
  minHeight: 44,
};

export const btnGold: CSSProperties = {
  padding: '10px 16px',
  borderRadius: 8,
  border: '1px solid rgba(201,164,92,0.45)',
  background: 'rgba(201,164,92,0.14)',
  color: '#8a6d2a',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'inherit',
  minHeight: 44,
};
