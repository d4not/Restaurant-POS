import { useRef, useState, type ReactNode } from 'react';
import { ApiError } from '../../api/client';
import { uploadImage, resolveImageUrl } from '../../api/uploads';

interface Props {
  /** Current value — either an "/uploads/<uuid>.ext" path or an external URL. */
  value: string;
  onChange: (next: string) => void;
  label?: ReactNode;
  hint?: ReactNode;
  error?: string;
  /** Compact (40×36) mode for inline header editors; full mode shows a 96×96 thumbnail. */
  compact?: boolean;
  disabled?: boolean;
}

/**
 * Hybrid image input: a "Choose file" button uploads to /uploads/image and
 * sets value to the returned path, while the text input still accepts
 * pasted external URLs. The thumbnail previews whatever value currently
 * resolves to a loadable URL.
 */
export function ImagePicker({
  value,
  onChange,
  label,
  hint,
  error,
  compact = false,
  disabled,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const previewSrc = resolveImageUrl(value);

  const onPick = async (file: File) => {
    setUploading(true);
    setUploadError(null);
    try {
      const { url } = await uploadImage(file);
      onChange(url);
    } catch (err) {
      setUploadError(
        err instanceof ApiError ? err.message : 'Upload failed',
      );
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const thumbSize = compact ? { w: 40, h: 36 } : { w: 96, h: 96 };

  return (
    <div className="field">
      {label && <label>{label}</label>}
      <div className="flex gap-8" style={{ alignItems: 'center' }}>
        {previewSrc && (
          <img
            src={previewSrc}
            alt=""
            style={{
              width: thumbSize.w,
              height: thumbSize.h,
              objectFit: 'cover',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border2)',
              background: 'var(--bg)',
              flexShrink: 0,
            }}
            onError={(ev) => {
              (ev.currentTarget as HTMLImageElement).style.visibility = 'hidden';
            }}
          />
        )}
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="https://… or click Upload"
          maxLength={500}
          disabled={disabled || uploading}
          style={{ flex: 1 }}
        />
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => fileRef.current?.click()}
          disabled={disabled || uploading}
        >
          {uploading ? 'Uploading…' : 'Upload'}
        </button>
        {value.trim() && !uploading && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => onChange('')}
            disabled={disabled}
            aria-label="Clear image"
          >
            ×
          </button>
        )}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void onPick(f);
        }}
      />
      {hint && !error && !uploadError && (
        <div className="fs-11 text-muted mt-4">{hint}</div>
      )}
      {(error || uploadError) && (
        <div className="field-error">{error || uploadError}</div>
      )}
    </div>
  );
}
