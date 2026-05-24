import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { listStorages, type Storage } from '../api/storages';
import { fetchAllSupplies, type SupplySummary } from '../api/supplies';
import { fetchAllProducts, type PosProduct } from '../api/products';
import { fetchAllCategories, type ProductCategory } from '../api/categories';
import {
  createWriteOffBatch,
  listWriteOffs,
  WRITE_OFF_REASONS,
  type WriteOff,
  type WriteOffReason,
} from '../api/write-offs';
import { fetchRecipeIngredients } from '../api/recipes';
import { ApiError } from '../api/client';
import { Spinner } from '../components/Spinner';
import { useUi } from '../store/ui';
import { useTranslation } from '../i18n';
import { contentToBase, baseToContent, formatQty } from '../utils/units';

const ALL_CATEGORIES = '__all__';

interface TicketLine {
  // local id; only used as React key + line ops
  uid: string;
  supply_id: string;
  supply_name: string;
  base_unit: string;
  content_unit: string | null;
  content_per_unit: number | null;
  // What the user is typing right now (string for input fidelity).
  qty: string;
  // Which unit qty is in. For piece-type supplies this always equals base_unit.
  qty_unit: string;
  // Tag used to group "this came from product X" lines so the ticket reads as
  // one removable card per product. Manual supply lines have no origin and
  // render in their own "Direct supplies" group at the bottom.
  origin?: { product_name: string; group_id: string };
}

type Tab = 'products' | 'supplies' | 'recent';

const PRODUCT_TYPES: Array<PosProduct['type']> = ['DISH', 'PRODUCT'];

const styles: Record<string, React.CSSProperties> = {
  shell: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    minHeight: 0,
    background: 'var(--bg)',
  },
  // Dark warm brown to match the main POS top bar (--sidebar). Title text in
  // cream and the active pill in gold — same palette the topbar uses for
  // active tabs — so the page reads as a sibling surface, not a stranger.
  head: {
    display: 'flex',
    alignItems: 'center',
    gap: 14,
    padding: '10px 16px',
    borderBottom: '1px solid rgba(0,0,0,0.2)',
    background: 'var(--sidebar)',
    color: '#e8ddd0',
    minHeight: 56,
    flexShrink: 0,
  },
  back: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    padding: '7px 12px 7px 9px',
    borderRadius: 7,
    border: '1px solid rgba(232,221,208,0.18)',
    background: 'rgba(232,221,208,0.08)',
    color: '#e8ddd0',
    fontSize: 12,
    fontWeight: 500,
    cursor: 'pointer',
    minHeight: 36,
    fontFamily: 'inherit',
  },
  hTitle: {
    fontFamily: "'Playfair Display', serif",
    fontSize: 22,
    fontWeight: 600,
    margin: 0,
    color: '#fff',
  },
  hSub: {
    fontSize: 11,
    color: 'rgba(232,221,208,0.55)',
    marginTop: 2,
    letterSpacing: '0.02em',
  },
  hSpacer: { flex: 1 },

  pillRow: {
    display: 'flex',
    gap: 6,
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  pillLabel: {
    fontSize: 10,
    letterSpacing: '0.14em',
    textTransform: 'uppercase',
    color: 'rgba(232,221,208,0.55)',
    fontWeight: 700,
    marginRight: 4,
  },

  body: {
    flex: 1,
    minHeight: 0,
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) 360px 280px',
    gap: 0,
    overflow: 'hidden',
  },

  // ─── Left: tabs + grid
  leftCol: {
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0,
    minHeight: 0,
    background: 'var(--bg)',
    borderRight: '1px solid var(--border)',
  },
  tabsRow: {
    display: 'flex',
    gap: 4,
    padding: '8px 14px',
    borderBottom: '1px solid var(--border)',
    alignItems: 'center',
    flexShrink: 0,
  },
  searchWrap: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '6px 10px',
    borderRadius: 7,
    border: '1px solid var(--border)',
    background: 'var(--bg2)',
    marginLeft: 'auto',
    minWidth: 220,
    minHeight: 36,
    flexShrink: 0,
  },
  searchInput: {
    border: 'none',
    outline: 'none',
    background: 'transparent',
    fontSize: 13,
    color: 'var(--text1)',
    flex: 1,
    fontFamily: 'inherit',
  },
  // The grid keeps a fixed footprint so opening a popover or scrolling never
  // resizes the surrounding chrome — the old modal's biggest UX wart.
  grid: {
    flex: 1,
    minHeight: 0,
    overflowY: 'auto',
    padding: '10px 12px calc(16px + var(--safe-bottom))',
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
    gap: 8,
    alignContent: 'start',
  },
  card: {
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    background: 'var(--bg2)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    padding: '10px 12px',
    cursor: 'pointer',
    textAlign: 'left',
    boxShadow: 'var(--shadow-sm)',
    fontFamily: 'inherit',
    transition: 'transform 0.08s, border-color 0.12s',
    minHeight: 64,
  },
  cardName: {
    fontSize: 12,
    fontWeight: 600,
    color: 'var(--text1)',
    lineHeight: 1.25,
    flex: 1,
  },
  cardMeta: {
    fontSize: 10,
    color: 'var(--text3)',
    marginTop: 6,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    fontWeight: 600,
  },
  emptyGrid: {
    padding: 48,
    textAlign: 'center',
    color: 'var(--text3)',
    fontSize: 13,
    gridColumn: '1 / -1',
  },

  // ─── Center: ticket
  ticketCol: {
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0,
    minHeight: 0,
    background: 'var(--bg2)',
    borderRight: '1px solid var(--border)',
  },
  ticketHead: {
    padding: '12px 16px 10px',
    borderBottom: '1px solid var(--border)',
    display: 'flex',
    alignItems: 'baseline',
    gap: 8,
    flexShrink: 0,
  },
  ticketTitle: {
    fontFamily: "'Playfair Display', serif",
    fontSize: 17,
    fontWeight: 600,
    color: 'var(--text1)',
    margin: 0,
  },
  ticketCount: {
    fontSize: 11,
    color: 'var(--text3)',
    fontWeight: 600,
  },
  ticketBody: {
    flex: 1,
    minHeight: 0,
    overflowY: 'auto',
  },
  // Each product expansion (or "Direct supplies" bucket) is a card. One big
  // remove button at the top-right wipes the whole group — what the barista
  // wants when they made a Mocha by mistake.
  groupCard: {
    margin: '12px 12px 0',
    border: '1px solid var(--border)',
    borderRadius: 10,
    background: 'var(--bg2)',
    overflow: 'hidden',
    boxShadow: 'var(--shadow-sm)',
  },
  groupHead: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '10px 12px 10px 14px',
    background: 'rgba(44,36,32,0.04)',
    borderBottom: '1px solid var(--border)',
  },
  groupLabel: {
    flex: 1,
    fontSize: 10,
    letterSpacing: '0.14em',
    textTransform: 'uppercase',
    color: 'var(--text2)',
    fontWeight: 700,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  groupRemoveBtn: {
    width: 36,
    height: 36,
    borderRadius: 8,
    border: '1px solid var(--border)',
    background: 'var(--bg)',
    color: 'var(--red)',
    fontSize: 18,
    fontWeight: 600,
    cursor: 'pointer',
    flexShrink: 0,
    fontFamily: 'inherit',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    lineHeight: 1,
  },
  lineRow: {
    padding: '10px 14px',
    borderBottom: '1px solid rgba(44,36,32,0.06)',
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  lineHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  lineName: {
    flex: 1,
    fontSize: 13,
    fontWeight: 500,
    color: 'var(--text1)',
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  removeBtn: {
    width: 26,
    height: 26,
    borderRadius: 6,
    border: '1px solid var(--border)',
    background: 'var(--bg)',
    color: 'var(--text2)',
    fontSize: 14,
    cursor: 'pointer',
    flexShrink: 0,
    fontFamily: 'inherit',
  },
  qtyRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  qtyInput: {
    flex: 1,
    minWidth: 0,
    height: 34,
    border: '1px solid var(--border)',
    borderRadius: 6,
    background: 'var(--bg)',
    padding: '0 10px',
    fontSize: 13,
    fontFamily: 'inherit',
    color: 'var(--text1)',
    outline: 'none',
    fontVariantNumeric: 'tabular-nums',
  },
  unitToggle: {
    display: 'inline-flex',
    border: '1px solid var(--border)',
    borderRadius: 6,
    overflow: 'hidden',
    background: 'var(--bg)',
  },
  unitStatic: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    color: 'var(--text2)',
    padding: '6px 10px',
    border: '1px solid var(--border)',
    borderRadius: 6,
    background: 'var(--bg)',
  },
  livePreview: {
    fontSize: 10,
    color: 'var(--text3)',
    fontVariantNumeric: 'tabular-nums',
    letterSpacing: '0.02em',
  },

  // ─── Right column
  rightCol: {
    display: 'flex',
    flexDirection: 'column',
    background: 'var(--bg)',
    padding: '14px 16px',
    gap: 12,
    overflowY: 'auto',
  },
  notesLabel: {
    fontSize: 10,
    letterSpacing: '0.14em',
    textTransform: 'uppercase',
    color: 'var(--text3)',
    fontWeight: 700,
  },
  notesArea: {
    width: '100%',
    minHeight: 72,
    padding: '10px 12px',
    border: '1px solid var(--border)',
    borderRadius: 8,
    background: 'var(--bg2)',
    fontSize: 13,
    fontFamily: 'inherit',
    color: 'var(--text1)',
    resize: 'vertical',
    outline: 'none',
  },
  bigBtn: {
    width: '100%',
    padding: '14px 18px',
    borderRadius: 10,
    background: 'var(--text1)',
    color: '#fff',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
    border: '1px solid var(--text1)',
    fontFamily: 'inherit',
    minHeight: 48,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  okBanner: {
    padding: '8px 12px',
    background: 'rgba(74,140,92,0.12)',
    color: 'var(--green)',
    border: '1px solid var(--green)',
    borderRadius: 6,
    fontSize: 12,
    fontWeight: 600,
  },
  errBanner: {
    padding: '8px 12px',
    background: 'rgba(196,80,64,0.10)',
    color: 'var(--red)',
    border: '1px solid var(--red)',
    borderRadius: 6,
    fontSize: 12,
    fontWeight: 600,
  },

  // ─── Recent tab
  recentRow: {
    display: 'grid',
    gridTemplateColumns: '1fr 90px 110px',
    gap: 10,
    padding: '10px 14px',
    fontSize: 13,
    color: 'var(--text1)',
    borderBottom: '1px solid var(--border)',
    alignItems: 'center',
  },
};

const unitBtn = (active: boolean): React.CSSProperties => ({
  padding: '6px 10px',
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  cursor: 'pointer',
  background: active ? 'var(--text1)' : 'transparent',
  color: active ? '#fff' : 'var(--text2)',
  border: 'none',
  fontFamily: 'inherit',
});

const pill = (active: boolean): React.CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  padding: '0 14px',
  borderRadius: 999,
  border: `1px solid ${active ? 'var(--text1)' : 'var(--border)'}`,
  background: active ? 'var(--text1)' : 'var(--bg)',
  color: active ? '#fff' : 'var(--text1)',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'inherit',
  minHeight: 36,
  transition: 'background 0.12s, color 0.12s, border-color 0.12s',
});

// Pill variant tuned for the dark-brown header — active fills with gold (same
// accent the main topbar uses for its active tab) so the selection feels like
// the rest of the POS, inactive stays a quiet cream-glass chip.
const headerPill = (active: boolean): React.CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  padding: '0 14px',
  borderRadius: 999,
  border: `1px solid ${active ? 'var(--gold)' : 'rgba(232,221,208,0.22)'}`,
  background: active ? 'var(--gold)' : 'rgba(232,221,208,0.06)',
  color: active ? '#2c2420' : 'rgba(232,221,208,0.85)',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'inherit',
  minHeight: 36,
  transition: 'background 0.12s, color 0.12s, border-color 0.12s',
});

const tabPill = (active: boolean): React.CSSProperties => ({
  padding: '8px 14px',
  borderRadius: 8,
  fontSize: 13,
  fontWeight: 600,
  color: active ? 'var(--text1)' : 'var(--text2)',
  background: active ? 'var(--bg2)' : 'transparent',
  border: '1px solid ' + (active ? 'var(--border)' : 'transparent'),
  cursor: 'pointer',
  fontFamily: 'inherit',
  minHeight: 36,
});

function uid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function isPieceOnly(s: { content_unit: string | null; content_per_unit: string | number | null }): boolean {
  return !s.content_unit || !s.content_per_unit;
}

interface ProductPopoverState {
  anchor: { x: number; y: number };
  product: PosProduct;
  variantId: string | null;
}

export function WastePage() {
  const { t } = useTranslation();
  const closeWaste = useUi((s) => s.closeWaste);
  const queryClient = useQueryClient();

  const [storageId, setStorageId] = useState<string>('');
  const [reason, setReason] = useState<WriteOffReason>('OTHER');
  const [notes, setNotes] = useState('');
  const [tab, setTab] = useState<Tab>('products');
  const [search, setSearch] = useState('');
  const [activeCat, setActiveCat] = useState<string>(ALL_CATEGORIES);
  const [lines, setLines] = useState<TicketLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [okBanner, setOkBanner] = useState<string | null>(null);
  const [productPopover, setProductPopover] = useState<ProductPopoverState | null>(null);

  const storagesQuery = useQuery<Storage[]>({
    queryKey: ['storages', 'active'],
    queryFn: () => listStorages({ active: true }),
    staleTime: 60_000,
  });
  const suppliesQuery = useQuery<SupplySummary[]>({
    queryKey: ['supplies', 'all-active'],
    queryFn: () => fetchAllSupplies(),
    staleTime: 60_000,
  });
  const productsQuery = useQuery<PosProduct[]>({
    queryKey: ['products', 'all'],
    queryFn: () => fetchAllProducts(),
    staleTime: 5 * 60_000,
  });
  const categoriesQuery = useQuery<ProductCategory[]>({
    queryKey: ['product-categories'],
    queryFn: () => fetchAllCategories(),
    staleTime: 5 * 60_000,
  });
  const historyQuery = useQuery({
    queryKey: ['write-offs', 'recent'],
    queryFn: () => listWriteOffs({ limit: 10 }),
    staleTime: 0,
  });

  const storages = storagesQuery.data ?? [];
  // Default the storage to the first one once it loads — most cafés have a
  // single station this barista is working from.
  useEffect(() => {
    if (!storageId && storages.length > 0) setStorageId(storages[0]!.id);
  }, [storages, storageId]);

  const supplies = suppliesQuery.data ?? [];
  const products = productsQuery.data ?? [];
  const categories = categoriesQuery.data ?? [];

  const filteredSupplies = useMemo(() => {
    const q = search.trim().toLowerCase();
    let pool = supplies.filter((s) => s.active);
    if (q) {
      pool = pool.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          (s.barcode ?? '').toLowerCase().includes(q),
      );
    }
    return pool.sort((a, b) => a.name.localeCompare(b.name));
  }, [supplies, search]);

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    let pool = products.filter(
      (p) => p.active && PRODUCT_TYPES.includes(p.type),
    );
    if (activeCat !== ALL_CATEGORIES) {
      pool = pool.filter((p) => p.category_id === activeCat);
    }
    if (q) {
      pool = pool.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.barcode ?? '').toLowerCase().includes(q),
      );
    }
    return pool.sort((a, b) => a.display_order - b.display_order || a.name.localeCompare(b.name));
  }, [products, activeCat, search]);

  // Group lines by their origin so a recipe-driven add reads as a coherent
  // sub-section in the ticket — "From: Caramel Latte ▼ <3 ingredients>".
  const groupedLines = useMemo(() => {
    const groups = new Map<string | null, TicketLine[]>();
    for (const l of lines) {
      const key = l.origin?.group_id ?? null;
      const arr = groups.get(key) ?? [];
      arr.push(l);
      groups.set(key, arr);
    }
    return Array.from(groups.entries());
  }, [lines]);

  // Resolve recipe ingredients when the user picks a mode in the popover.
  const recipeMutation = useMutation({
    mutationFn: async ({
      productId,
      variantId,
    }: {
      productId: string;
      variantId: string | null;
    }) => fetchRecipeIngredients(productId, variantId),
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : t('waste.recipeLoadFailed'));
    },
  });

  function addSupplyLine(supply: SupplySummary): void {
    const isPiece = isPieceOnly(supply);
    const defaultUnit = isPiece ? supply.base_unit : supply.content_unit!;
    setLines((prev) => [
      ...prev,
      {
        uid: uid(),
        supply_id: supply.id,
        supply_name: supply.name,
        base_unit: supply.base_unit,
        content_unit: supply.content_unit,
        content_per_unit: supply.content_per_unit ? Number(supply.content_per_unit) : null,
        qty: '',
        qty_unit: defaultUnit,
      },
    ]);
  }

  // Seeds the ticket with one editable line per recipe ingredient. Both popover
  // modes ("Whole product" / "Pick ingredients") use the same path now — the
  // barista always gets to tweak; nothing is locked. The card-level remove on
  // the group makes "I made the wrong drink, dump it" a one-tap action.
  async function addRecipeLines(
    product: PosProduct,
    variantId: string | null,
  ): Promise<void> {
    try {
      const resolved = await recipeMutation.mutateAsync({
        productId: product.id,
        variantId,
      });
      if (resolved.length === 0) {
        setError(t('waste.recipeEmpty').replace('{name}', product.name));
        return;
      }
      const groupId = uid();
      const newLines: TicketLine[] = resolved.map((r) => {
        const cpu = r.content_per_unit ? Number(r.content_per_unit) : null;
        const isPiece = !r.content_unit || !cpu;
        const defaultUnit = isPiece ? r.base_unit : r.content_unit!;
        const defaultQty = isPiece
          ? Number(r.base_qty)
          : r.content_qty
            ? Number(r.content_qty)
            : Number(r.base_qty);
        return {
          uid: uid(),
          supply_id: r.supply_id,
          supply_name: r.supply_name,
          base_unit: r.base_unit,
          content_unit: r.content_unit,
          content_per_unit: cpu,
          qty: formatQty(defaultQty),
          qty_unit: defaultUnit,
          origin: { product_name: product.name, group_id: groupId },
        };
      });
      setLines((prev) => [...prev, ...newLines]);
      setError(null);
    } catch {
      /* error surfaced by mutation onError */
    }
  }

  function removeGroup(groupId: string | null): void {
    if (groupId == null) {
      // The "Direct supplies" bucket — drop every manually-added line.
      setLines((prev) => prev.filter((l) => l.origin));
    } else {
      setLines((prev) => prev.filter((l) => l.origin?.group_id !== groupId));
    }
  }

  function openProductPopover(e: React.MouseEvent, product: PosProduct): void {
    // Anchor at the click point, clamped to the viewport.
    const x = Math.max(12, e.clientX);
    const y = Math.max(12, e.clientY);
    const variantId = product.variants.length === 1 ? product.variants[0]!.id : null;
    setProductPopover({ anchor: { x, y }, product, variantId });
  }

  function closePopover(): void {
    setProductPopover(null);
  }

  function removeLine(uid: string): void {
    setLines((prev) => prev.filter((l) => l.uid !== uid));
  }

  function updateLineQty(uid: string, qty: string): void {
    setLines((prev) => prev.map((l) => (l.uid === uid ? { ...l, qty } : l)));
  }

  function updateLineUnit(uid: string, nextUnit: string): void {
    setLines((prev) =>
      prev.map((l) => {
        if (l.uid !== uid) return l;
        if (l.qty_unit === nextUnit) return l;
        // When toggling content_unit ↔ base_unit, convert the displayed qty so
        // the magnitude reflects the same physical amount.
        const n = Number(l.qty);
        if (!Number.isFinite(n) || n === 0) {
          return { ...l, qty_unit: nextUnit };
        }
        let next = n;
        if (l.qty_unit === l.content_unit && nextUnit === l.base_unit) {
          next = contentToBase(n, l.content_unit, l.content_per_unit);
        } else if (l.qty_unit === l.base_unit && nextUnit === l.content_unit) {
          next = baseToContent(n, l.content_unit, l.content_per_unit);
        }
        return { ...l, qty_unit: nextUnit, qty: formatQty(next) };
      }),
    );
  }

  function liveBaseQty(line: TicketLine): number {
    const n = Number(line.qty);
    if (!Number.isFinite(n) || n <= 0) return 0;
    if (line.qty_unit === line.base_unit) return n;
    return contentToBase(n, line.content_unit, line.content_per_unit);
  }

  const submitMutation = useMutation({
    mutationFn: async () => {
      const items = lines.map((l) => {
        const qtyNum = Number(l.qty);
        if (!Number.isFinite(qtyNum) || qtyNum <= 0) {
          throw new Error(
            t('waste.invalidLine').replace('{name}', l.supply_name),
          );
        }
        const baseQty = liveBaseQty(l);
        return { supply_id: l.supply_id, quantity: Number(baseQty.toFixed(4)) };
      });
      // Single supply may appear multiple times (e.g. wasted from two products)
      // — collapse so the backend records one WriteOff per supply.
      const merged = new Map<string, number>();
      for (const it of items) {
        merged.set(it.supply_id, (merged.get(it.supply_id) ?? 0) + it.quantity);
      }
      const payload = Array.from(merged.entries()).map(([supply_id, quantity]) => ({
        supply_id,
        quantity: Number(quantity.toFixed(4)),
      }));
      return createWriteOffBatch({
        storage_id: storageId,
        date: new Date().toISOString(),
        reason,
        notes: notes.trim() || undefined,
        items: payload,
      });
    },
    onSuccess: async (rows) => {
      setOkBanner(
        t('waste.batchOk').replace('{n}', String(rows.length)),
      );
      setLines([]);
      setNotes('');
      setError(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['write-offs'] }),
        queryClient.invalidateQueries({ queryKey: ['supplies'] }),
      ]);
      window.setTimeout(() => setOkBanner(null), 2500);
    },
    onError: (err) => {
      setOkBanner(null);
      if (err instanceof ApiError) {
        setError(err.code === 'CONFLICT' ? t('waste.insufficientStock') : err.message);
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError(t('waste.failed'));
      }
    },
  });

  function submit(): void {
    setError(null);
    if (!storageId) {
      setError(t('waste.pickStorageFirst'));
      return;
    }
    if (lines.length === 0) {
      setError(t('waste.ticketEmpty'));
      return;
    }
    submitMutation.mutate();
  }

  // ESC closes the page (only when no popover is up).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      if (productPopover) {
        e.preventDefault();
        closePopover();
        return;
      }
      e.preventDefault();
      closeWaste();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [closeWaste, productPopover]);

  const recentHistory = historyQuery.data?.items ?? [];

  return (
    <div style={styles.shell}>
      <div style={styles.head}>
        <button type="button" style={styles.back} onClick={closeWaste}>
          ← {t('common.back')}
        </button>
        <div>
          <h1 style={styles.hTitle}>{t('waste.title')}</h1>
          <div style={styles.hSub}>{t('waste.subtitle')}</div>
        </div>
        <div style={styles.hSpacer} />
        <div style={styles.pillRow}>
          <span style={styles.pillLabel}>{t('waste.storage')}</span>
          {storages.length === 0 ? (
            <span style={{ fontSize: 12, color: 'rgba(232,221,208,0.55)' }}>—</span>
          ) : (
            storages.map((s) => (
              <button
                key={s.id}
                type="button"
                style={headerPill(s.id === storageId)}
                onClick={() => setStorageId(s.id)}
              >
                {s.name}
              </button>
            ))
          )}
        </div>
        <div style={styles.pillRow}>
          <span style={styles.pillLabel}>{t('waste.reason')}</span>
          {WRITE_OFF_REASONS.map((r) => (
            <button
              key={r}
              type="button"
              style={headerPill(r === reason)}
              onClick={() => setReason(r)}
            >
              {t(`waste.reason.${r}`)}
            </button>
          ))}
        </div>
      </div>

      <div style={styles.body}>
        {/* ─── Left column */}
        <div style={styles.leftCol}>
          <div style={styles.tabsRow}>
            <button type="button" style={tabPill(tab === 'products')} onClick={() => setTab('products')}>
              {t('waste.tab.products')}
            </button>
            <button type="button" style={tabPill(tab === 'supplies')} onClick={() => setTab('supplies')}>
              {t('waste.tab.supplies')}
            </button>
            <button type="button" style={tabPill(tab === 'recent')} onClick={() => setTab('recent')}>
              {t('waste.tab.recent')}
            </button>
            {tab !== 'recent' && (
              <div style={styles.searchWrap}>
                <input
                  style={styles.searchInput}
                  placeholder={
                    tab === 'products' ? t('waste.searchProducts') : t('waste.searchSupplies')
                  }
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            )}
          </div>

          {tab === 'products' && (
            <>
              {categories.length > 0 && (
                <div style={{ ...styles.tabsRow, borderBottom: '1px solid var(--border)' }}>
                  <button
                    type="button"
                    style={tabPill(activeCat === ALL_CATEGORIES)}
                    onClick={() => setActiveCat(ALL_CATEGORIES)}
                  >
                    {t('common.all')}
                  </button>
                  {categories.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      style={tabPill(activeCat === c.id)}
                      onClick={() => setActiveCat(c.id)}
                    >
                      {c.name}
                    </button>
                  ))}
                </div>
              )}
              <div style={styles.grid}>
                {filteredProducts.length === 0 ? (
                  <div style={styles.emptyGrid}>{t('waste.noProducts')}</div>
                ) : (
                  filteredProducts.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      style={styles.card}
                      onClick={(e) => openProductPopover(e, p)}
                    >
                      <div style={styles.cardName}>{p.name}</div>
                      <div style={styles.cardMeta}>
                        {p.variants.length > 0
                          ? t('waste.variantCount').replace('{n}', String(p.variants.length))
                          : t(`waste.type.${p.type}`)}
                      </div>
                    </button>
                  ))
                )}
              </div>
            </>
          )}

          {tab === 'supplies' && (
            <div style={styles.grid}>
              {filteredSupplies.length === 0 ? (
                <div style={styles.emptyGrid}>{t('waste.noSupplies')}</div>
              ) : (
                filteredSupplies.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    style={styles.card}
                    onClick={() => addSupplyLine(s)}
                  >
                    <div style={styles.cardName}>{s.name}</div>
                    <div style={styles.cardMeta}>
                      {s.base_unit}
                      {s.content_per_unit && s.content_unit
                        ? ` · ${s.content_per_unit} ${s.content_unit}`
                        : ''}
                    </div>
                  </button>
                ))
              )}
            </div>
          )}

          {tab === 'recent' && (
            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
              {recentHistory.length === 0 ? (
                <div style={styles.emptyGrid}>{t('waste.historyEmpty')}</div>
              ) : (
                recentHistory.map((row: WriteOff) => (
                  <div key={row.id} style={styles.recentRow}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {row.supply.name}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>
                        {row.storage.name} · {t(`waste.reason.${row.reason}`)}
                      </div>
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--text2)', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {Number(row.quantity).toLocaleString()} {row.supply.base_unit}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text3)', textAlign: 'right' }}>
                      {new Date(row.date).toLocaleString(undefined, {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* ─── Center column: ticket */}
        <div style={styles.ticketCol}>
          <div style={styles.ticketHead}>
            <h2 style={styles.ticketTitle}>{t('waste.ticketTitle')}</h2>
            <span style={styles.ticketCount}>
              {lines.length === 0
                ? t('waste.ticketEmptyShort')
                : t('waste.ticketCount').replace('{n}', String(lines.length))}
            </span>
          </div>
          <div style={styles.ticketBody}>
            {lines.length === 0 ? (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>
                {t('waste.ticketHint')}
              </div>
            ) : (
              groupedLines.map(([groupId, groupLines]) => {
                const origin = groupLines[0]!.origin;
                const headerText = origin
                  ? t('waste.fromProduct').replace('{name}', origin.product_name)
                  : t('waste.directSupplies');
                return (
                  <div key={groupId ?? 'manual'} style={styles.groupCard}>
                    <div style={styles.groupHead}>
                      <div style={styles.groupLabel} title={headerText}>
                        {headerText}
                      </div>
                      <button
                        type="button"
                        style={styles.groupRemoveBtn}
                        onClick={() => removeGroup(groupId)}
                        title={
                          origin
                            ? t('waste.groupRemove').replace('{name}', origin.product_name)
                            : t('waste.groupRemoveDirect')
                        }
                        aria-label={
                          origin
                            ? t('waste.groupRemove').replace('{name}', origin.product_name)
                            : t('waste.groupRemoveDirect')
                        }
                      >
                        ×
                      </button>
                    </div>
                    {groupLines.map((l, idx) => {
                      const isPiece = !l.content_unit || !l.content_per_unit;
                      const baseQty = liveBaseQty(l);
                      const showPreview = !isPiece && l.qty_unit !== l.base_unit && baseQty > 0;
                      const isLast = idx === groupLines.length - 1;
                      return (
                        <div
                          key={l.uid}
                          style={
                            isLast
                              ? { ...styles.lineRow, borderBottom: 'none' }
                              : styles.lineRow
                          }
                        >
                          <div style={styles.lineHeader}>
                            <div style={styles.lineName}>{l.supply_name}</div>
                            <button
                              type="button"
                              style={styles.removeBtn}
                              onClick={() => removeLine(l.uid)}
                              title={t('waste.lineRemove')}
                              aria-label={t('waste.lineRemove')}
                            >
                              ×
                            </button>
                          </div>
                          <div style={styles.qtyRow}>
                            <input
                              style={styles.qtyInput}
                              type="number"
                              inputMode="decimal"
                              min="0"
                              step="0.0001"
                              value={l.qty}
                              onChange={(e) => updateLineQty(l.uid, e.target.value)}
                            />
                            {isPiece ? (
                              <span style={styles.unitStatic}>{l.base_unit}</span>
                            ) : (
                              <div style={styles.unitToggle}>
                                <button
                                  type="button"
                                  style={unitBtn(l.qty_unit === l.content_unit)}
                                  onClick={() => updateLineUnit(l.uid, l.content_unit!)}
                                >
                                  {l.content_unit}
                                </button>
                                <button
                                  type="button"
                                  style={unitBtn(l.qty_unit === l.base_unit)}
                                  onClick={() => updateLineUnit(l.uid, l.base_unit)}
                                >
                                  {l.base_unit}
                                </button>
                              </div>
                            )}
                          </div>
                          {showPreview && (
                            <div style={styles.livePreview}>
                              ≈ {formatQty(baseQty)} {l.base_unit}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })
            )}
            {/* Tiny breathing room so the last card doesn't kiss the scroll edge */}
            {lines.length > 0 && <div style={{ height: 12 }} />}
          </div>
        </div>

        {/* ─── Right column: notes + submit */}
        <div style={styles.rightCol}>
          <div>
            <div style={styles.notesLabel}>{t('waste.notes')}</div>
            <textarea
              style={styles.notesArea}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={2000}
              placeholder={t('waste.notesPlaceholder')}
            />
          </div>

          {okBanner && <div style={styles.okBanner}>{okBanner}</div>}
          {error && <div style={styles.errBanner}>{error}</div>}

          <button
            type="button"
            style={{
              ...styles.bigBtn,
              opacity: lines.length === 0 || submitMutation.isPending ? 0.5 : 1,
              cursor: lines.length === 0 || submitMutation.isPending ? 'not-allowed' : 'pointer',
            }}
            onClick={submit}
            disabled={lines.length === 0 || submitMutation.isPending}
          >
            {submitMutation.isPending && <Spinner size={14} />}
            {t('waste.submit')}
          </button>
        </div>
      </div>

      {productPopover && (
        <ProductPopover
          state={productPopover}
          onClose={closePopover}
          onPickWhole={(variantId) => {
            const { product } = productPopover;
            closePopover();
            void addRecipeLines(product, variantId);
          }}
          onPickIngredients={(variantId) => {
            const { product } = productPopover;
            closePopover();
            void addRecipeLines(product, variantId);
          }}
          loading={recipeMutation.isPending}
          t={t}
        />
      )}
    </div>
  );
}

interface PopoverProps {
  state: ProductPopoverState;
  loading: boolean;
  onClose: () => void;
  onPickWhole: (variantId: string | null) => void;
  onPickIngredients: (variantId: string | null) => void;
  t: (key: string) => string;
}

function ProductPopover({ state, loading, onClose, onPickWhole, onPickIngredients, t }: PopoverProps) {
  const { product } = state;
  const [variantId, setVariantId] = useState<string | null>(state.variantId);
  const ref = useRef<HTMLDivElement | null>(null);

  // Position the popover near the click but keep it within the viewport.
  const left = Math.min(state.anchor.x, window.innerWidth - 320);
  const top = Math.min(state.anchor.y, window.innerHeight - 240);

  // Click outside to dismiss.
  useEffect(() => {
    const onDoc = (e: MouseEvent): void => {
      if (!ref.current) return;
      if (ref.current.contains(e.target as Node)) return;
      onClose();
    };
    window.addEventListener('mousedown', onDoc);
    return () => window.removeEventListener('mousedown', onDoc);
  }, [onClose]);

  return (
    <div
      ref={ref}
      style={{
        position: 'fixed',
        top,
        left,
        zIndex: 80,
        width: 300,
        background: 'var(--bg2)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        boxShadow: '0 16px 40px rgba(44,36,32,0.22)',
        padding: 14,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 17, fontWeight: 600, color: 'var(--text1)' }}>
        {product.name}
      </div>
      {product.variants.length > 1 && (
        <div>
          <div style={{ fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--text3)', fontWeight: 700, marginBottom: 6 }}>
            {t('waste.popoverVariant')}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {product.variants.map((v) => (
              <button
                key={v.id}
                type="button"
                style={pill(variantId === v.id)}
                onClick={() => setVariantId(v.id)}
              >
                {v.name}
              </button>
            ))}
          </div>
        </div>
      )}
      <button
        type="button"
        style={{
          padding: '10px 12px',
          borderRadius: 8,
          background: 'var(--text1)',
          color: '#fff',
          border: '1px solid var(--text1)',
          fontSize: 13,
          fontWeight: 600,
          cursor: 'pointer',
          fontFamily: 'inherit',
          minHeight: 40,
          opacity: loading ? 0.6 : 1,
        }}
        disabled={loading}
        onClick={() => onPickWhole(variantId)}
      >
        {t('waste.popoverWholeProduct')}
      </button>
      <button
        type="button"
        style={{
          padding: '10px 12px',
          borderRadius: 8,
          background: 'var(--bg)',
          color: 'var(--text1)',
          border: '1px solid var(--border)',
          fontSize: 13,
          fontWeight: 600,
          cursor: 'pointer',
          fontFamily: 'inherit',
          minHeight: 40,
          opacity: loading ? 0.6 : 1,
        }}
        disabled={loading}
        onClick={() => onPickIngredients(variantId)}
      >
        {t('waste.popoverPickIngredients')}
      </button>
    </div>
  );
}
