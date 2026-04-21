import { useEffect, useMemo, useState } from 'react';
import { Modal, Button, Badge, EmptyState } from '../../components/ui';
import { SearchInput } from '../../components/forms/SearchInput';
import {
  useAttachModifierGroup,
} from '../../hooks/useProducts';
import { useModifierGroups } from '../../hooks/useModifierGroups';

interface Props {
  open: boolean;
  onClose: () => void;
  productId: string;
  /** IDs of already-attached groups so we can hide them. */
  attachedIds: string[];
}

export function AttachModifierGroupModal({
  open,
  onClose,
  productId,
  attachedIds,
}: Props) {
  const [search, setSearch] = useState('');
  const [serverError, setServerError] = useState<string | null>(null);

  const groupsQ = useModifierGroups({ search: search || undefined });
  const attach = useAttachModifierGroup(productId);

  useEffect(() => {
    if (!open) {
      setSearch('');
      setServerError(null);
    }
  }, [open]);

  const attachedSet = useMemo(() => new Set(attachedIds), [attachedIds]);
  const groups = useMemo(() => {
    const items = groupsQ.data?.items ?? [];
    return items.filter((g) => !attachedSet.has(g.id));
  }, [groupsQ.data, attachedSet]);

  const onAttach = async (groupId: string) => {
    setServerError(null);
    try {
      await attach.mutateAsync(groupId);
      onClose();
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Failed to attach');
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Attach modifier group"
      size="sm"
      closeOnOverlay={!attach.isPending}
      footer={
        <Button variant="ghost" onClick={onClose} disabled={attach.isPending}>
          Close
        </Button>
      }
    >
      {serverError && (
        <div className="auth-alert" style={{ marginBottom: 12 }}>
          {serverError}
        </div>
      )}
      <div className="mb-12">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search modifier groups…"
        />
      </div>

      {groupsQ.isLoading ? (
        <div className="loading-block">
          <span className="spinner" />
          Loading…
        </div>
      ) : groups.length === 0 ? (
        <EmptyState
          message="No groups to attach"
          sub={
            attachedIds.length > 0 && !search
              ? 'All available groups are already attached to this product.'
              : 'Create modifier groups first, then come back to attach them.'
          }
        />
      ) : (
        <div className="attach-list">
          {groups.map((g) => (
            <button
              key={g.id}
              type="button"
              className="attach-item"
              onClick={() => onAttach(g.id)}
              disabled={attach.isPending}
            >
              <div>
                <div className="fw-600 fs-13">{g.name}</div>
                <div className="fs-11 text-muted mt-4">
                  {g.modifiers?.length ?? 0} modifiers · min {g.min_selection} · max {g.max_selection}
                </div>
              </div>
              {g.required && <Badge tone="gold">Required</Badge>}
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}
