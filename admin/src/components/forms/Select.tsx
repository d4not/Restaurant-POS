import type { SelectHTMLAttributes, ReactNode } from 'react';

export interface SelectOption<V extends string = string> {
  value: V;
  label: string;
  disabled?: boolean;
}

interface SelectProps<V extends string = string>
  extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'value' | 'onChange'> {
  label?: ReactNode;
  options: SelectOption<V>[];
  value: V | '';
  onValueChange: (value: V | '') => void;
  placeholder?: string;
  error?: string;
}

export function Select<V extends string = string>({
  label,
  options,
  value,
  onValueChange,
  placeholder,
  error,
  id,
  name,
  ...rest
}: SelectProps<V>) {
  const selectId = id ?? name;
  return (
    <div className="field">
      {label && <label htmlFor={selectId}>{label}</label>}
      <select
        id={selectId}
        name={name}
        value={value}
        onChange={(e) => onValueChange(e.target.value as V | '')}
        {...rest}
      >
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((opt) => (
          <option key={opt.value} value={opt.value} disabled={opt.disabled}>
            {opt.label}
          </option>
        ))}
      </select>
      {error && <div className="field-error">{error}</div>}
    </div>
  );
}
