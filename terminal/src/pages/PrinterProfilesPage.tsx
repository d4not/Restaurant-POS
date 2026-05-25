import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Spinner } from '../components/Spinner';
import { useTranslation } from '../i18n';
import { useSession } from '../store/session';
import { useUi } from '../store/ui';
import { fetchAllCategories } from '../api/categories';
import { fetchProfilesStatus } from '../api/printer-profiles';
import {
  usePrinterProfiles,
  useCreateProfile,
  useUpdateProfile,
  useDeleteProfile,
  useAssignCategories,
} from '../hooks/usePrinterProfiles';
import { usePrinters, usePrintersStatus } from '../hooks/usePrinters';
import { PrinterProfileCard } from '../components/printer/PrinterProfileCard';
import { PrinterProfileEditor } from '../components/printer/PrinterProfileEditor';
import { PrinterListTab } from '../components/printer/PrinterListTab';
import type { PrinterProfile, CreateProfileInput } from '../api/printer-profiles';

type PageTab = 'printers' | 'profiles';
type ProfileView = 'list' | 'create' | 'edit';
const MANAGER_ROLES = new Set(['MANAGER', 'ADMIN']);

export function PrinterProfilesPage() {
  const { t } = useTranslation();
  const role = useSession((s) => s.user?.role ?? 'WAITER');
  const setView = useUi((s) => s.setView);
  const canEdit = MANAGER_ROLES.has(role);

  const [tab, setTab] = useState<PageTab>('printers');
  const [profileView, setProfileView] = useState<ProfileView>('list');
  const [editingProfile, setEditingProfile] = useState<PrinterProfile | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const profilesQuery = usePrinterProfiles();
  const profileStatusQuery = useQuery({
    queryKey: ['printer-profiles-status'],
    queryFn: fetchProfilesStatus,
    refetchInterval: 30_000,
  });
  const categoriesQuery = useQuery({
    queryKey: ['categories-all'],
    queryFn: fetchAllCategories,
    staleTime: 120_000,
  });
  const printersQuery = usePrinters();
  const printersStatusQuery = usePrintersStatus();

  const createMut = useCreateProfile();
  const updateMut = useUpdateProfile();
  const deleteMut = useDeleteProfile();
  const assignMut = useAssignCategories();

  const profiles = profilesQuery.data ?? [];
  const categories = categoriesQuery.data ?? [];
  const printers = printersQuery.data ?? [];
  const assignedCatIds = new Set(profiles.flatMap((p) => p.categories.map((c) => c.id)));
  const unassigned = categories.filter((c) => !assignedCatIds.has(c.id));

  async function handleSave(input: CreateProfileInput, categoryIds: string[]): Promise<boolean> {
    setSaveError(null);
    try {
      if (editingProfile) {
        await updateMut.mutateAsync({ id: editingProfile.id, input });
        await assignMut.mutateAsync({ profileId: editingProfile.id, categoryIds });
      } else {
        const created = await createMut.mutateAsync(input);
        if (categoryIds.length > 0) {
          await assignMut.mutateAsync({ profileId: created.id, categoryIds });
        }
      }
      setProfileView('list');
      setEditingProfile(null);
      return true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Save failed';
      setSaveError(msg);
      return false;
    }
  }

  async function handleDelete(id: string) {
    await deleteMut.mutateAsync(id);
    setConfirmDelete(null);
  }

  const showAddProfileBtn = canEdit && tab === 'profiles' && profileView === 'list';

  return (
    <div style={shell}>
      {/* Header */}
      <header style={header}>
        <button type="button" style={backBtn} onClick={() => setView('orders')}>
          <span style={{ fontSize: 16 }}>&larr;</span> {t('common.back')}
        </button>
        <div style={titleBlock}>
          <h1 style={titleStyle}>{t('printers.pageTitle')}</h1>
          <span style={subtitle}>{t('printers.pageSubtitle')}</span>
        </div>
        <div style={{ flex: 1 }} />
        {showAddProfileBtn && (
          <button
            type="button"
            style={addBtn}
            onClick={() => { setEditingProfile(null); setProfileView('create'); }}
          >
            + {t('printers.newProfile')}
          </button>
        )}
      </header>

      {/* Tab pills */}
      <div style={tabBar}>
        <div style={tabWrap}>
          <button
            type="button"
            style={tab === 'printers' ? tabPillActive : tabPill}
            onClick={() => { setTab('printers'); setProfileView('list'); setEditingProfile(null); }}
          >
            {t('printers.tabPrinters')}
            {printers.length > 0 && (
              <span style={tabCount(tab === 'printers')}>{printers.length}</span>
            )}
          </button>
          <button
            type="button"
            style={tab === 'profiles' ? tabPillActive : tabPill}
            onClick={() => setTab('profiles')}
          >
            {t('printers.tabProfiles')}
            {profiles.length > 0 && (
              <span style={tabCount(tab === 'profiles')}>{profiles.length}</span>
            )}
          </button>
        </div>
      </div>

      {/* Content */}
      <div style={content}>
        <div style={contentInner}>

          {/* ── Printers Tab ── */}
          {tab === 'printers' && (
            <PrinterListTab
              printers={printers}
              printersStatus={printersStatusQuery.data ?? {}}
              profiles={profiles}
              canEdit={canEdit}
              loading={printersQuery.isLoading}
            />
          )}

          {/* ── Profiles Tab ── */}
          {tab === 'profiles' && (
            <>
              {profilesQuery.isLoading && (
                <div style={loadingStyle}>
                  <Spinner size={20} /> {t('settings.loadingPrinterConfig')}
                </div>
              )}

              {/* Editor */}
              {(profileView === 'create' || profileView === 'edit') && (
                <div style={editorWrap}>
                  {saveError && (
                    <div style={errorBanner}>
                      {saveError}
                      <button type="button" style={errorDismiss} onClick={() => setSaveError(null)}>
                        &times;
                      </button>
                    </div>
                  )}
                  <PrinterProfileEditor
                    profile={editingProfile}
                    allProfiles={profiles}
                    printers={printers}
                    onSave={handleSave}
                    onCancel={() => { setProfileView('list'); setEditingProfile(null); setSaveError(null); }}
                    saving={createMut.isPending || updateMut.isPending || assignMut.isPending}
                  />
                </div>
              )}

              {/* List */}
              {profileView === 'list' && !profilesQuery.isLoading && (
                <>
                  {profiles.length === 0 && (
                    <div style={emptyState}>
                      <div style={emptyIcon}>
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--text3)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M6 9V2h12v7" /><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
                          <rect x="6" y="14" width="12" height="8" />
                        </svg>
                      </div>
                      <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--text2)' }}>
                        {t('printers.emptyState')}
                      </div>
                      {canEdit && (
                        <button
                          type="button"
                          style={{ ...addBtnInline, marginTop: 16 }}
                          onClick={() => { setEditingProfile(null); setProfileView('create'); }}
                        >
                          + {t('printers.newProfile')}
                        </button>
                      )}
                    </div>
                  )}

                  <div style={grid}>
                    {profiles.map((profile) => (
                      <div key={profile.id}>
                        <PrinterProfileCard
                          profile={profile}
                          connected={
                            (profile.printer?.address || profile.address)
                              ? (profileStatusQuery.data?.[profile.id] ?? null)
                              : null
                          }
                          canEdit={canEdit}
                          onEdit={() => { setEditingProfile(profile); setProfileView('edit'); }}
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
                  </div>

                  {unassigned.length > 0 && profiles.length > 0 && (
                    <div style={unassignedBanner}>
                      <span style={{ fontWeight: 600 }}>{t('printers.unassignedTitle')}</span>{' '}
                      {unassigned.map((c) => c.name).join(', ')}
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ConfirmDeleteBar({
  name, onConfirm, onCancel, deleting,
}: {
  name: string; onConfirm: () => void; onCancel: () => void; deleting: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div style={confirmBar}>
      <span>{t('printers.confirmDelete').replace('{name}', name)}</span>
      <button type="button" style={confirmYes} onClick={onConfirm} disabled={deleting}>
        {deleting ? <Spinner size={10} /> : null} {t('common.delete')}
      </button>
      <button type="button" style={cancelBtn} onClick={onCancel}>
        {t('common.cancel')}
      </button>
    </div>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────

const shell: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  minHeight: 0,
  background: 'var(--bg)',
};

const header: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 14,
  padding: '10px 16px',
  borderBottom: '1px solid rgba(0,0,0,0.2)',
  background: 'var(--sidebar)',
  color: '#e8ddd0',
  flexShrink: 0,
  minHeight: 56,
};

const backBtn: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  padding: '7px 12px 7px 9px',
  borderRadius: 7,
  border: '1px solid rgba(232,221,208,0.18)',
  background: 'rgba(232,221,208,0.08)',
  color: '#e8ddd0',
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
  fontFamily: 'inherit',
  minHeight: 40,
};

const titleBlock: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
};

const titleStyle: React.CSSProperties = {
  fontFamily: "'Playfair Display', serif",
  fontSize: 22,
  fontWeight: 600,
  margin: 0,
  color: '#fff',
};

const subtitle: React.CSSProperties = {
  fontSize: 12,
  color: 'rgba(232,221,208,0.55)',
  marginTop: 2,
};

const addBtn: React.CSSProperties = {
  padding: '10px 18px',
  borderRadius: 8,
  background: 'var(--gold)',
  color: '#2c2420',
  fontSize: 13,
  fontWeight: 600,
  border: '1px solid rgba(44,36,32,0.08)',
  cursor: 'pointer',
  fontFamily: 'inherit',
  minHeight: 40,
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
};

const addBtnInline: React.CSSProperties = {
  padding: '10px 18px',
  borderRadius: 8,
  background: 'var(--gold)',
  color: '#2c2420',
  fontSize: 13,
  fontWeight: 600,
  border: '1px solid rgba(44,36,32,0.08)',
  cursor: 'pointer',
  fontFamily: 'inherit',
  minHeight: 40,
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
};

const tabBar: React.CSSProperties = {
  padding: '12px 24px',
  borderBottom: '1px solid var(--border)',
  flexShrink: 0,
  display: 'flex',
  justifyContent: 'center',
};

const tabWrap: React.CSSProperties = {
  display: 'flex',
  gap: 4,
  background: 'rgba(44,36,32,0.04)',
  padding: 3,
  borderRadius: 10,
};

const tabPill: React.CSSProperties = {
  padding: '10px 22px',
  borderRadius: 8,
  fontSize: 14,
  fontWeight: 600,
  color: 'var(--text2)',
  background: 'transparent',
  border: 'none',
  cursor: 'pointer',
  fontFamily: 'inherit',
  minHeight: 44,
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  transition: 'all 0.15s',
};

const tabPillActive: React.CSSProperties = {
  ...tabPill,
  color: '#2c2420',
  background: 'var(--bg2)',
  boxShadow: '0 1px 3px rgba(44,36,32,0.08)',
};

const tabCount = (active: boolean): React.CSSProperties => ({
  fontSize: 11,
  fontWeight: 700,
  padding: '1px 7px',
  borderRadius: 999,
  background: active ? 'rgba(44,36,32,0.08)' : 'rgba(44,36,32,0.04)',
  color: active ? 'var(--text1)' : 'var(--text3)',
});

const content: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
  padding: '24px 28px',
};

const contentInner: React.CSSProperties = {
  maxWidth: 1100,
  margin: '0 auto',
};

const grid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))',
  gap: 14,
};

const editorWrap: React.CSSProperties = {
  maxWidth: 640,
  margin: '0 auto',
};

const loadingStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 12,
  padding: '60px 24px',
  color: 'var(--text2)',
};

const emptyState: React.CSSProperties = {
  textAlign: 'center',
  padding: '60px 24px',
  color: 'var(--text3)',
};

const emptyIcon: React.CSSProperties = {
  marginBottom: 16,
  opacity: 0.5,
};

const unassignedBanner: React.CSSProperties = {
  marginTop: 20,
  padding: '12px 16px',
  borderRadius: 10,
  background: 'rgba(201,164,92,0.10)',
  border: '1px solid rgba(201,164,92,0.4)',
  color: '#8a6d2a',
  fontSize: 13,
  lineHeight: 1.5,
};

const confirmBar: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '10px 14px',
  marginTop: -4,
  marginBottom: 14,
  borderRadius: 8,
  background: 'rgba(196,80,64,0.08)',
  border: '1px solid rgba(196,80,64,0.3)',
  fontSize: 12,
  color: 'var(--red)',
};

const confirmYes: React.CSSProperties = {
  padding: '6px 14px',
  borderRadius: 6,
  background: 'var(--red)',
  color: '#fff',
  fontSize: 12,
  fontWeight: 600,
  border: 'none',
  cursor: 'pointer',
  fontFamily: 'inherit',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
};

const cancelBtn: React.CSSProperties = {
  padding: '6px 14px',
  borderRadius: 6,
  background: 'var(--bg2)',
  color: 'var(--text1)',
  fontSize: 12,
  fontWeight: 500,
  border: '1px solid var(--border)',
  cursor: 'pointer',
  fontFamily: 'inherit',
};

const errorBanner: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '10px 14px',
  marginBottom: 16,
  borderRadius: 8,
  background: 'rgba(196,80,64,0.10)',
  border: '1px solid rgba(196,80,64,0.4)',
  fontSize: 13,
  color: 'var(--red)',
  fontWeight: 500,
};

const errorDismiss: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: 'var(--red)',
  fontSize: 16,
  cursor: 'pointer',
  padding: '0 4px',
  fontFamily: 'inherit',
};
