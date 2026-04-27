import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { Badge, Button, Card } from '../../components/ui';
import { Select } from '../../components/forms/Select';
import { useSuppliers } from '../../hooks/useSuppliers';
import { useStorages } from '../../hooks/useStorages';
import { lookupBarcode, type BarcodeLookupResult } from '../../api/supplies';
import { ApiError } from '../../api/client';
import { SupplyEditor } from './SupplyEditor';

// Quick supply entry — designed for a USB barcode scanner workflow:
//
//   1. Pick the supplier you're buying from (sticky for the session)
//   2. Scanner emits keystrokes + Enter into the barcode field
//   3. Backend lookup either surfaces an existing supply (offers a jump to
//      its detail page) or prefills the form below
//   4. The form below IS the same SupplyEditor used by /new and /:id —
//      embedded with prefill props so what you see during quick-add is
//      identical to what you'd see editing the supply later
//   5. Save → toast + form clears, focus snaps back to the barcode field

type LookupState =
  | { kind: 'idle' }
  | { kind: 'loading'; barcode: string }
  | { kind: 'existing'; barcode: string; result: BarcodeLookupResult }
  | { kind: 'found'; barcode: string; result: BarcodeLookupResult }
  | { kind: 'empty'; barcode: string }
  | { kind: 'error'; barcode: string; message: string };

export function SupplyQuickAdd() {
  const navigate = useNavigate();
  const barcodeInputRef = useRef<HTMLInputElement | null>(null);

  // Sticky supplier + storage — when the user is at Sam's bringing things to
  // the Warehouse, every scan goes against the same pair. Persisted in
  // sessionStorage so a stray reload doesn't lose them.
  const [supplierId, setSupplierId] = useState<string>(() =>
    typeof window !== 'undefined'
      ? window.sessionStorage.getItem('quickadd:supplier_id') ?? ''
      : '',
  );
  const [storageId, setStorageId] = useState<string>(() =>
    typeof window !== 'undefined'
      ? window.sessionStorage.getItem('quickadd:storage_id') ?? ''
      : '',
  );

  const [barcodeInput, setBarcodeInput] = useState('');
  const [lookup, setLookup] = useState<LookupState>({ kind: 'idle' });
  const [savedCount, setSavedCount] = useState(0);
  const [lastSavedName, setLastSavedName] = useState<string | null>(null);

  const suppliersQ = useSuppliers({ active: true });
  const storagesQ = useStorages();
  const suppliers = useMemo(
    () => suppliersQ.data?.pages.flatMap((p) => p.items) ?? [],
    [suppliersQ.data],
  );
  const storages = useMemo(
    () => storagesQ.data?.items.filter((s) => s.active) ?? [],
    [storagesQ.data],
  );
  const supplierName = useMemo(
    () => suppliers.find((s) => s.id === supplierId)?.name ?? null,
    [suppliers, supplierId],
  );
  const storageName = useMemo(
    () => storages.find((s) => s.id === storageId)?.name ?? null,
    [storages, storageId],
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (supplierId) {
      window.sessionStorage.setItem('quickadd:supplier_id', supplierId);
    } else {
      window.sessionStorage.removeItem('quickadd:supplier_id');
    }
  }, [supplierId]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (storageId) {
      window.sessionStorage.setItem('quickadd:storage_id', storageId);
    } else {
      window.sessionStorage.removeItem('quickadd:storage_id');
    }
  }, [storageId]);

  // Autofocus the barcode field once the supplier is locked in. Re-runs
  // whenever the form is reset so the next scan goes straight in.
  useEffect(() => {
    if (supplierId && lookup.kind === 'idle') {
      barcodeInputRef.current?.focus();
    }
  }, [supplierId, lookup.kind]);

  const lookupMutation = useMutation({
    mutationFn: (barcode: string) => lookupBarcode(barcode),
  });

  const handleBarcodeSubmit = async (barcode: string) => {
    const trimmed = barcode.trim();
    if (!trimmed) return;
    setLookup({ kind: 'loading', barcode: trimmed });
    try {
      const result = await lookupMutation.mutateAsync(trimmed);
      if (result.existing) {
        setLookup({ kind: 'existing', barcode: trimmed, result });
      } else if (result.lookup) {
        setLookup({ kind: 'found', barcode: trimmed, result });
      } else {
        setLookup({ kind: 'empty', barcode: trimmed });
      }
    } catch (err) {
      setLookup({
        kind: 'error',
        barcode: trimmed,
        message: err instanceof ApiError ? err.message : 'Lookup failed',
      });
    }
  };

  const onBarcodeKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void handleBarcodeSubmit(barcodeInput);
    }
  };

  const resetForNextScan = () => {
    setBarcodeInput('');
    setLookup({ kind: 'idle' });
    setTimeout(() => barcodeInputRef.current?.focus(), 0);
  };

  // Compute the editor prefill from the OFF lookup result. Memoized so the
  // SupplyEditor's lazy state initializer sees the same object reference
  // each render of a given lookup state — and so the form doesn't get
  // surprise-resets while the user is typing.
  const editorPrefill = useMemo(() => {
    if (lookup.kind === 'found' && lookup.result.lookup) {
      const l = lookup.result.lookup;
      return {
        barcode: lookup.barcode,
        name: l.brand ? `${l.name} (${l.brand})` : l.name,
        image_url: l.image_url,
        content_per_unit: l.content_per_unit,
        content_unit: l.content_unit,
        suggestedCategories: l.categories,
        source: l.source,
      };
    }
    if (lookup.kind === 'empty') {
      return { barcode: lookup.barcode };
    }
    return undefined;
  }, [lookup]);

  // SupplyEditor is fully unmounted between scans (key=barcode) so its
  // internal state resets cleanly. No need for a separate reset prop.
  const showEditor = lookup.kind === 'found' || lookup.kind === 'empty';

  return (
    <>
      <div className="flex-between mb-16" style={{ flexWrap: 'wrap', gap: 8 }}>
        <div>
          <Link
            to="/inventory/supplies"
            className="fs-12 text-muted"
            style={{ display: 'inline-block', marginBottom: 6 }}
          >
            ← Back to supplies
          </Link>
          <h1 style={{ fontFamily: "'Playfair Display', serif", fontSize: 24 }}>
            Quick add supply
          </h1>
          <div className="fs-12 text-muted mt-4">
            Scan a barcode → verify the prefilled data → save. Designed for
            stocking runs.
          </div>
        </div>
        {savedCount > 0 && (
          <Badge tone="green">{savedCount} added this session</Badge>
        )}
      </div>

      {/* Supplier + storage pickers — sticky for the session */}
      <Card>
        <div className="section-grid-2">
          <div>
            <Select
              label="Supplier you're buying from"
              name="supplier"
              value={supplierId}
              onValueChange={setSupplierId}
              placeholder={suppliersQ.isLoading ? 'Loading…' : 'Select supplier…'}
              options={suppliers.map((s) => ({ value: s.id, label: s.name }))}
              disabled={suppliersQ.isLoading}
            />
            <div className="fs-11 text-muted mt-4">
              Every scan attaches to this supplier.
            </div>
          </div>
          <div>
            <Select
              label="Where the stock lands"
              name="storage"
              value={storageId}
              onValueChange={setStorageId}
              placeholder={storagesQ.isLoading ? 'Loading…' : 'Pick storage…'}
              options={storages.map((s) => ({ value: s.id, label: s.name }))}
              disabled={storagesQ.isLoading}
            />
            <div className="fs-11 text-muted mt-4">
              Initial-stock purchases go here. Leave blank to skip auto-purchase.
            </div>
          </div>
        </div>
      </Card>

      {/* Barcode input — disabled until supplier is picked */}
      <Card style={{ marginTop: 14 }}>
        <label
          htmlFor="quickadd-barcode"
          style={{
            display: 'block',
            fontFamily: "'Playfair Display', serif",
            fontSize: 16,
            marginBottom: 8,
          }}
        >
          Scan or type barcode
        </label>
        <div className="flex" style={{ gap: 8 }}>
          <input
            id="quickadd-barcode"
            ref={barcodeInputRef}
            type="text"
            inputMode="numeric"
            autoComplete="off"
            spellCheck={false}
            value={barcodeInput}
            onChange={(e) => setBarcodeInput(e.target.value)}
            onKeyDown={onBarcodeKeyDown}
            disabled={!supplierId || lookup.kind === 'loading'}
            placeholder={
              supplierId
                ? 'Point scanner here, or type and press Enter'
                : 'Pick a supplier above first…'
            }
            style={{
              flex: 1,
              height: 56,
              fontSize: 22,
              fontFamily: 'monospace',
              letterSpacing: '0.04em',
              padding: '0 16px',
              border: '1px solid var(--border2)',
              borderRadius: 'var(--radius)',
              background: 'var(--bg)',
              outline: 'none',
            }}
          />
          <Button
            variant="primary"
            onClick={() => void handleBarcodeSubmit(barcodeInput)}
            disabled={!supplierId || !barcodeInput.trim() || lookup.kind === 'loading'}
          >
            Lookup
          </Button>
        </div>

        {lastSavedName && lookup.kind === 'idle' && (
          <div
            className="fs-12 text-green mt-8"
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            ✓ Saved <strong>{lastSavedName}</strong> — ready for the next scan
          </div>
        )}

        {lookup.kind === 'loading' && (
          <div className="fs-12 text-muted mt-8">
            Looking up barcode <strong>{lookup.barcode}</strong>…
          </div>
        )}

        {lookup.kind === 'error' && (
          <div className="auth-alert mt-8">
            {lookup.message}
            <Button
              variant="ghost"
              size="sm"
              onClick={resetForNextScan}
              style={{ marginLeft: 8 }}
            >
              Dismiss
            </Button>
          </div>
        )}
      </Card>

      {/* Existing supply hit */}
      {lookup.kind === 'existing' && lookup.result.existing && (
        <Card style={{ marginTop: 14 }}>
          <h3 style={{ marginBottom: 10 }}>Already in your catalog</h3>
          <div className="detail-grid mb-12">
            <div className="detail-row cols-2">
              <div className="detail-cell">
                <div className="dk">Barcode</div>
                <div className="dv" style={{ fontFamily: 'monospace' }}>
                  {lookup.barcode}
                </div>
              </div>
              <div className="detail-cell">
                <div className="dk">Existing supply</div>
                <div className="dv fw-600">{lookup.result.existing.name}</div>
              </div>
            </div>
          </div>
          <div className="flex gap-8" style={{ flexWrap: 'wrap' }}>
            <Button
              variant="primary"
              onClick={() =>
                navigate(`/inventory/supplies/${lookup.result.existing!.id}`)
              }
            >
              Open supply detail →
            </Button>
            <Button variant="ghost" onClick={resetForNextScan}>
              Skip — scan another
            </Button>
          </div>
        </Card>
      )}

      {/* Embedded editor — same component used by /new and /:id, just with
          prefill data and a quick-add-friendly save handler. The key forces
          an unmount between scans so the editor's internal state resets. */}
      {showEditor && (
        <Card
          style={{
            marginTop: 14,
            padding: '18px 18px 8px',
          }}
        >
          <div className="flex-between mb-12" style={{ alignItems: 'flex-start' }}>
            <div>
              <h3 style={{ margin: 0 }}>
                {lookup.kind === 'found' ? 'Verify and save' : 'Manual entry'}
              </h3>
              <div className="fs-11 text-muted mt-4">
                Barcode:{' '}
                <span style={{ fontFamily: 'monospace' }}>{lookup.barcode}</span>
                {lookup.kind === 'found' && (
                  <>
                    {' · '}
                    <Badge tone="gold">Open Food Facts</Badge>
                  </>
                )}
                {lookup.kind === 'empty' && (
                  <>
                    {' · '}
                    <Badge tone="gray">Not found — fill manually</Badge>
                  </>
                )}
                {supplierName && (
                  <>
                    {' · supplier '}
                    <strong>{supplierName}</strong>
                  </>
                )}
                {storageName && (
                  <>
                    {' · storage '}
                    <strong>{storageName}</strong>
                  </>
                )}
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={resetForNextScan}>
              Cancel scan
            </Button>
          </div>

          <SupplyEditor
            key={lookup.barcode}
            mode="create"
            embedded
            prefill={editorPrefill}
            fixedSupplierId={supplierId || undefined}
            fixedStorageId={storageId || undefined}
            saveLabel="Save & next scan"
            onSaved={(supply) => {
              setSavedCount((n) => n + 1);
              setLastSavedName(supply.name);
              resetForNextScan();
            }}
          />
        </Card>
      )}
    </>
  );
}
