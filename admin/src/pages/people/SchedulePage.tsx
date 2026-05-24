import { useMemo, useState } from 'react';
import { Card, EmptyState } from '../../components/ui';
import { SearchInput } from '../../components/forms/SearchInput';
import {
  useClearScheduleDay,
  useRoster,
  useUpsertScheduleDay,
} from '../../hooks/useSchedule';
import { ScheduleGrid } from '../../components/people/ScheduleGrid';
import { SlotEditorPopover } from '../../components/people/SlotEditorPopover';
import type { RosterRow, ScheduleSlot } from '../../types/people';
import { useTranslation } from '../../i18n';
import { useAuthStore } from '../../store/auth';

export function SchedulePage() {
  const { t } = useTranslation();
  const role = useAuthStore((s) => s.user?.role);
  const canEdit = role === 'MANAGER' || role === 'ADMIN';

  const [search, setSearch] = useState('');
  const [editor, setEditor] = useState<{
    userId: string;
    dayOfWeek: number;
    slot: ScheduleSlot | null;
    anchor: HTMLElement;
  } | null>(null);

  const q = useRoster();
  const roster = useMemo(() => {
    const all = q.data ?? [];
    const term = search.trim().toLowerCase();
    if (!term) return all;
    return all.filter((row) => row.user_name.toLowerCase().includes(term));
  }, [q.data, search]);

  const upsertM = useUpsertScheduleDay();
  const clearM = useClearScheduleDay();

  return (
    <>
      <Card>
        <h1 style={{ fontSize: 24, marginBottom: 4 }}>
          {t('people.schedule.title')}
        </h1>
        <div className="fs-13 text-muted">{t('people.schedule.subtitle')}</div>
      </Card>

      <div className="toolbar" style={{ marginTop: 16, marginBottom: 16 }}>
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder={t('people.schedule.searchPlaceholder')}
        />
      </div>

      <Card>
        {q.isLoading && (
          <div className="loading-block">
            <span className="spinner" />
            {t('common.loading')}…
          </div>
        )}
        {q.error && (
          <EmptyState
            icon="⚠"
            message={t('error.failedLoad')}
            sub={(q.error as Error).message}
          />
        )}
        {!q.isLoading && !q.error && (
          <div
            onClick={(e) => {
              const button = (e.target as HTMLElement).closest('button[data-cell]');
              if (!button) return;
              const userId = button.getAttribute('data-user');
              const day = button.getAttribute('data-day');
              if (!userId || day == null) return;
              const dayNum = Number(day);
              const row = roster.find((r) => r.user_id === userId);
              const slot = row?.week[dayNum] ?? null;
              if (!canEdit) return;
              setEditor({
                userId,
                dayOfWeek: dayNum,
                slot,
                anchor: button as HTMLElement,
              });
            }}
          >
            <RosterAccessibleGrid roster={roster} readOnly={!canEdit} />
          </div>
        )}
      </Card>

      {editor && (
        <SlotEditorPopover
          open
          anchorEl={editor.anchor}
          initial={editor.slot}
          onSave={(start, end) => {
            void upsertM.mutateAsync({
              userId: editor.userId,
              dayOfWeek: editor.dayOfWeek,
              input: { start_minutes: start, end_minutes: end, active: true },
            });
          }}
          onClear={() => {
            void clearM.mutateAsync({
              userId: editor.userId,
              dayOfWeek: editor.dayOfWeek,
            });
          }}
          onClose={() => setEditor(null)}
        />
      )}
    </>
  );
}

/**
 * Re-renders the roster grid with data-user / data-day attributes on every
 * cell so the parent can resolve which cell was clicked from a delegated
 * handler. Keeps the styling consistent with ScheduleGrid by composing it.
 */
function RosterAccessibleGrid({
  roster,
  readOnly,
}: {
  roster: RosterRow[];
  readOnly: boolean;
}) {
  // ScheduleGrid renders <button> elements but doesn't expose data attrs. We
  // wrap it and use a ref to walk the DOM, stamping attrs on mount/update.
  // The actual click handling lives in the parent (delegated via onClick).
  return (
    <div
      ref={(el) => {
        if (!el) return;
        const buttons = el.querySelectorAll('button');
        // Mark every button as a schedule cell so the parent's delegated
        // handler can pick it up. Header divs are not buttons, so they're
        // skipped automatically.
        let buttonIdx = 0;
        for (let i = 0; i < roster.length; i++) {
          const row = roster[i]!;
          for (let day = 0; day < 7; day++) {
            const btn = buttons[buttonIdx++];
            if (!btn) break;
            btn.setAttribute('data-cell', '1');
            btn.setAttribute('data-user', row.user_id);
            btn.setAttribute('data-day', String(day));
          }
        }
      }}
    >
      <ScheduleGrid mode="roster" roster={roster} readOnly={readOnly} />
    </div>
  );
}
