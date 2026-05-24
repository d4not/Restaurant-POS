import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Spinner } from '../Spinner';
import { useTranslation } from '../../i18n';
import { useSession } from '../../store/session';
import { fetchAllCategories } from '../../api/categories';
import {
  usePrinterProfiles,
  useCreateProfile,
  useUpdateProfile,
  useDeleteProfile,
  useAssignCategories,
} from '../../hooks/usePrinterProfiles';
import { getPrinterStatus } from '../../api/print';
import { PrinterProfileCard } from './PrinterProfileCard';
import { PrinterProfileEditor } from './PrinterProfileEditor';
import { ps } from './styles';
import type { PrinterProfile, CreateProfileInput } from '../../api/printer-profiles';

type View = 'list' | 'create' | 'edit';

const MANAGER_ROLES = new Set(['MANAGER', 'ADMIN']);

export function PrintersSection() {
  const { t } = useTranslation();
  const role = useSession((s) => s.user?.role ?? 'WAITER');
  const canEdit = MANAGER_ROLES.has(role);

  const profilesQuery = usePrinterProfiles();
  const statusQuery = useQuery({
    queryKey: ['printer-status', 'remote'],
    queryFn: getPrinterStatus,
    refetchInterval: 30_000,
  });
  const categoriesQuery = useQuery({
    queryKey: ['categories-all'],
    queryFn: fetchAllCategories,
    staleTime: 120_000,
  });

  const createMut = useCreateProfile();
  const updateMut = useUpdateProfile();
  const deleteMut = useDeleteProfile();
  const assignMut = useAssignCategories();

  const [view, setView] = useState<View>('list');
  const [editingProfile, setEditingProfile] = useState<PrinterProfile | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  if (profilesQuery.isLoading) {
    return (
      <div style={ps.loading}>
        <Spinner size={18} /> {t('settings.loadingPrinterConfig')}
      </div>
    );
  }

  const profiles = profilesQuery.data ?? [];
  const categories = categoriesQuery.data ?? [];

  // Find categories not assigned to any profile
  const assignedCatIds = new Set(profiles.flatMap((p) => p.categories.map((c) => c.id)));
  const unassigned = categories.filter((c) => !assignedCatIds.has(c.id));

  async function handleSave(input: CreateProfileInput, categoryIds: string[]) {
    if (editingProfile) {
      await updateMut.mutateAsync({ id: editingProfile.id, input });
      await assignMut.mutateAsync({ profileId: editingProfile.id, categoryIds });
    } else {
      const created = await createMut.mutateAsync(input);
      if (categoryIds.length > 0) {
        await assignMut.mutateAsync({ profileId: created.id, categoryIds });
      }
    }
    setView('list');
    setEditingProfile(null);
  }

  async function handleDelete(id: string) {
    await deleteMut.mutateAsync(id);
    setConfirmDelete(null);
  }

  // Editor view
  if (view === 'create' || view === 'edit') {
    return (
      <PrinterProfileEditor
        profile={editingProfile}
        allProfiles={profiles}
        onSave={handleSave}
        onCancel={() => { setView('list'); setEditingProfile(null); }}
        saving={createMut.isPending || updateMut.isPending || assignMut.isPending}
      />
    );
  }

  // List view
  return (
    <>
      {/* Header */}
      <div style={headerRow}>
        <div>
          <div style={{ fontSize: 12, color: 'var(--text3)' }}>
            {t('printers.profileCount').replace('{n}', String(profiles.length))}
          </div>
        </div>
        {canEdit && (
          <button type="button" style={ps.primaryBtn} onClick={() => { setEditingProfile(null); setView('create'); }}>
            + {t('printers.newProfile')}
          </button>
        )}
      </div>

      {/* Profile cards */}
      {profiles.length === 0 && (
        <div style={emptyState}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>🖨</div>
          <div>{t('printers.emptyState')}</div>
          {canEdit && (
            <button
              type="button"
              style={{ ...ps.goldBtn, marginTop: 12 }}
              onClick={() => { setEditingProfile(null); setView('create'); }}
            >
              + {t('printers.newProfile')}
            </button>
          )}
        </div>
      )}

      {profiles.map((profile) => (
        <div key={profile.id}>
          <PrinterProfileCard
            profile={profile}
            connected={getProfileConnected(profile, statusQuery.data)}
            canEdit={canEdit}
            onEdit={() => { setEditingProfile(profile); setView('edit'); }}
            onDelete={() => setConfirmDelete(profile.id)}
          />
          {confirmDelete === profile.id && (
            <ConfirmDeleteBar
              name={profile.name}
              onConfirm={() => handleDelete(profile.id)}
              onCancel={() => setConfirmDelete(null)}
              deleting={deleteMut.isPending}
            />
          )}
        </div>
      ))}

      {/* Unassigned categories warning */}
      {unassigned.length > 0 && profiles.length > 0 && (
        <div style={unassignedBanner}>
          <span style={{ fontWeight: 600 }}>{t('printers.unassignedTitle')}</span>{' '}
          {unassigned.map((c) => c.name).join(', ')}
        </div>
      )}
    </>
  );
}

function getProfileConnected(
  profile: PrinterProfile,
  status: { kitchen: { ip: string; connected: boolean }; receipt: { ip: string; connected: boolean } } | undefined,
): boolean | null {
  if (!status || !profile.address) return null;
  const [ip] = profile.address.split(':');
  if (status.kitchen.ip === ip) return status.kitchen.connected;
  if (status.receipt.ip === ip) return status.receipt.connected;
  return null;
}

function ConfirmDeleteBar({
  name,
  onConfirm,
  onCancel,
  deleting,
}: {
  name: string;
  onConfirm: () => void;
  onCancel: () => void;
  deleting: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div style={confirmBar}>
      <span>{t('printers.confirmDelete').replace('{name}', name)}</span>
      <button type="button" style={confirmYes} onClick={onConfirm} disabled={deleting}>
        {deleting ? <Spinner size={10} /> : null} {t('common.delete')}
      </button>
      <button type="button" style={ps.ghostBtn} onClick={onCancel}>
        {t('common.cancel')}
      </button>
    </div>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────

const headerRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  marginBottom: 14,
};

const emptyState: React.CSSProperties = {
  textAlign: 'center',
  padding: '48px 24px',
  color: 'var(--text3)',
  fontSize: 13,
};

const unassignedBanner: React.CSSProperties = {
  marginTop: 12,
  padding: '10px 14px',
  borderRadius: 8,
  background: 'rgba(201,164,92,0.10)',
  border: '1px solid rgba(201,164,92,0.4)',
  color: '#8a6d2a',
  fontSize: 12,
  lineHeight: 1.5,
};

const confirmBar: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '8px 12px',
  marginTop: -8,
  marginBottom: 12,
  borderRadius: 8,
  background: 'rgba(196,80,64,0.08)',
  border: '1px solid rgba(196,80,64,0.3)',
  fontSize: 12,
  color: 'var(--red)',
};

const confirmYes: React.CSSProperties = {
  padding: '5px 12px',
  borderRadius: 6,
  background: 'var(--red)',
  color: '#fff',
  fontSize: 11,
  fontWeight: 600,
  border: 'none',
  cursor: 'pointer',
  fontFamily: 'inherit',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
};
