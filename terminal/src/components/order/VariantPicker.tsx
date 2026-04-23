import type { Product, ProductVariant } from '../../types/api';
import { formatMoney } from '../../utils/format';

interface Props {
  product: Product;
  onPick: (variant: ProductVariant) => void;
  onCancel: () => void;
}

/**
 * First step when a DISH with variants is tapped. Shows each size as a tall
 * button (the tap-target rule is ~56px) with its price. Cancelling returns
 * to the product grid without touching the cart.
 */
export function VariantPicker({ product, onPick, onCancel }: Props) {
  const variants = product.variants.filter((v) => v.active);
  return (
    <div className="modal-overlay" role="dialog" aria-label={`Pick a size for ${product.name}`}>
      <div className="modal">
        <header className="modal-header">
          <div>
            <div className="text-mute" style={{ fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase' }}>
              Pick a size
            </div>
            <h2 style={{ marginTop: 4 }}>{product.name}</h2>
          </div>
        </header>
        <div className="modal-body">
          <div className="mod-options">
            {variants.map((v) => (
              <button
                key={v.id}
                type="button"
                className="mod-option"
                onClick={() => onPick(v)}
              >
                <span>{v.name}</span>
                <span className="extra">{formatMoney(v.sell_price)}</span>
              </button>
            ))}
          </div>
        </div>
        <footer className="modal-footer">
          <span className="preview text-mute" style={{ fontSize: 13 }}>
            Tap a size to continue
          </span>
          <button type="button" className="btn btn-ghost btn-lg" onClick={onCancel}>
            Cancel
          </button>
        </footer>
      </div>
    </div>
  );
}
