import { useEffect, useState } from 'react';

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Debounce delay in ms. Default 300. */
  debounceMs?: number;
  className?: string;
}

/**
 * Controlled search box with an internal debounced state: keystrokes update
 * the visible input immediately but the parent only sees the value once
 * typing pauses, so query refetches don't hammer the API.
 */
export function SearchInput({
  value,
  onChange,
  placeholder = 'Search…',
  debounceMs = 300,
  className,
}: SearchInputProps) {
  const [local, setLocal] = useState(value);

  // External value changed (e.g. clear filter) → sync down.
  useEffect(() => {
    setLocal(value);
  }, [value]);

  // Debounce local → parent.
  useEffect(() => {
    if (local === value) return;
    const t = setTimeout(() => onChange(local), debounceMs);
    return () => clearTimeout(t);
    // onChange is intentionally excluded — the parent usually passes a new
    // function reference each render, which would reset the timer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [local, debounceMs]);

  return (
    <input
      type="search"
      className={`search-box ${className ?? ''}`}
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      placeholder={placeholder}
    />
  );
}
