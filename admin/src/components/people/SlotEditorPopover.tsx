import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { Button } from '../ui';
import type { ScheduleSlot } from '../../types/people';
import { useTranslation } from '../../i18n';
import { formatTime } from './ScheduleGrid';

interface Props {
  open: boolean;
  /** Anchor element (the clicked cell). Used to position the popover. */
  anchorEl?: HTMLElement | null;
  /** The slot being edited, or null for a fresh entry. */
  initial: ScheduleSlot | null;
  onSave: (start: number, end: number) => void;
  onClear: () => void;
  onClose: () => void;
}

function parseTime(value: string): number | null {
  if (!/^\d{1,2}:\d{2}$/.test(value)) return null;
  const [h, m] = value.split(':').map(Number);
  if (
    !Number.isFinite(h) ||
    !Number.isFinite(m) ||
    h < 0 ||
    h > 24 ||
    m < 0 ||
    m > 59
  ) {
    return null;
  }
  const total = h * 60 + m;
  return total > 1440 ? null : total;
}

interface PopPos {
  top: number;
  left: number;
}

export function SlotEditorPopover({
  open,
  anchorEl,
  initial,
  onSave,
  onClear,
  onClose,
}: Props) {
  const { t } = useTranslation();
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('17:00');
  const [pos, setPos] = useState<PopPos | null>(null);
  const popRef = useRef<HTMLDivElement>(null);

  // Sync inputs when reopening / switching cells.
  useEffect(() => {
    if (!open) return;
    if (initial) {
      setStartTime(formatTime(initial.start_minutes));
      setEndTime(formatTime(initial.end_minutes));
    } else {
      setStartTime('09:00');
      setEndTime('17:00');
    }
  }, [open, initial]);

  // Position the popover near its anchor — fixed-position so it escapes
  // overflow contexts. Re-measure on resize/scroll like useAnchoredPos.
  useEffect(() => {
    if (!open || !anchorEl) {
      setPos(null);
      return;
    }
    const measure = () => {
      const rect = anchorEl.getBoundingClientRect();
      const popW = 280;
      const popH = 200;
      // Open below by default; flip above if there's no room.
      let top = rect.bottom + 6;
      if (top + popH > window.innerHeight - 8) {
        top = Math.max(8, rect.top - popH - 6);
      }
      let left = rect.left;
      if (left + popW > window.innerWidth - 8) {
        left = Math.max(8, window.innerWidth - popW - 8);
      }
      setPos({ top, left });
    };
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [open, anchorEl]);

  // Close on outside-click / Esc.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const onClick = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (popRef.current?.contains(target ?? null)) return;
      if (anchorEl?.contains(target ?? null)) return;
      onClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [open, anchorEl, onClose]);

  if (!open || !pos) return null;

  const startMins = parseTime(startTime);
  const endMins = parseTime(endTime);
  const valid =
    startMins !== null && endMins !== null && endMins > startMins;

  const style: CSSProperties = {
    position: 'fixed',
    top: pos.top,
    left: pos.left,
    width: 280,
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    boxShadow: 'var(--shadow-lg)',
    padding: 16,
    zIndex: 500,
  };

  return (
    <div ref={popRef} style={style} onClick={(e) => e.stopPropagation()}>
      <div
        style={{
          fontFamily: "'Playfair Display', serif",
          fontSize: 14,
          fontWeight: 600,
          color: 'var(--text)',
          marginBottom: 12,
        }}
      >
        {initial ? t('people.schedule.editSlot') : t('people.schedule.addSlot')}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>{t('people.schedule.start')}</label>
          <input
            type="time"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            autoFocus
          />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>{t('people.schedule.end')}</label>
          <input
            type="time"
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
          />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        {initial && (
          <Button
            variant="danger"
            size="sm"
            onClick={() => {
              onClear();
              onClose();
            }}
          >
            {t('people.schedule.clear')}
          </Button>
        )}
        <div style={{ flex: 1 }} />
        <Button variant="ghost" size="sm" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button
          variant="primary"
          size="sm"
          disabled={!valid}
          onClick={() => {
            if (!valid) return;
            onSave(startMins, endMins);
            onClose();
          }}
        >
          {t('common.save')}
        </Button>
      </div>
    </div>
  );
}
