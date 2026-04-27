import {
  ALL_TAKEOUT_CHANNELS,
  channelEnabled,
  type SettingsMap,
} from '../api/settings';
import type { TakeoutChannel } from '../api/orders';
import { useTranslation } from '../i18n';

const CHANNEL_LABEL_KEY: Record<TakeoutChannel, string> = {
  LOCAL: 'takeout.channelLocal',
  DELIVERY_LOCAL: 'takeout.channelDeliveryLocal',
  DELIVERY_APP: 'takeout.channelDeliveryApp',
};

const CHANNEL_HINT_KEY: Record<TakeoutChannel, string> = {
  LOCAL: 'takeout.channelLocalHint',
  DELIVERY_LOCAL: 'takeout.channelDeliveryLocalHint',
  DELIVERY_APP: 'takeout.channelDeliveryAppHint',
};

/**
 * Hook variant of TAKEOUT_CHANNEL_LABEL — returns a function that translates a
 * channel into the active language. Components that need the label inside a
 * render path can call this and forget about subscribing manually.
 */
export function useTakeoutChannelLabel() {
  const { t } = useTranslation();
  return (channel: TakeoutChannel) => t(CHANNEL_LABEL_KEY[channel]);
}

interface Props {
  open: boolean;
  busy?: boolean;
  error?: string | null;
  settings: SettingsMap | undefined;
  onCancel: () => void;
  onChoose: (channel: TakeoutChannel) => void;
}

const optionStyle = (disabled: boolean): React.CSSProperties => ({
  width: '100%',
  textAlign: 'left',
  padding: '14px 16px',
  borderRadius: 12,
  border: '1px solid var(--border)',
  background: disabled ? 'var(--bg)' : 'var(--bg2)',
  color: disabled ? 'var(--text3)' : 'var(--text1)',
  cursor: disabled ? 'not-allowed' : 'pointer',
  display: 'flex',
  alignItems: 'center',
  gap: 14,
  transition: 'border 0.12s, background 0.12s',
  fontFamily: 'inherit',
  minHeight: 64,
});

const optionDotStyle = (color: string): React.CSSProperties => ({
  width: 10,
  height: 10,
  borderRadius: '50%',
  background: color,
  flexShrink: 0,
});

const styles: Record<string, React.CSSProperties> = {
  scrim: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(44,36,32,0.42)',
    zIndex: 60,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modal: {
    width: 480,
    maxWidth: '92vw',
    background: 'var(--bg2)',
    borderRadius: 16,
    boxShadow: '0 24px 64px rgba(0,0,0,0.32)',
    border: '1px solid var(--border)',
    overflow: 'hidden',
  },
  head: {
    padding: '20px 24px 14px',
    borderBottom: '1px solid var(--border)',
  },
  title: {
    fontFamily: "'Playfair Display', serif",
    fontSize: 22,
    fontWeight: 600,
    margin: 0,
  },
  sub: {
    fontSize: 12,
    color: 'var(--text2)',
    marginTop: 4,
  },
  body: {
    padding: '18px 24px',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  optionText: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    flex: 1,
    minWidth: 0,
  },
  optionTitle: {
    fontSize: 14,
    fontWeight: 600,
  },
  optionHint: {
    fontSize: 12,
    color: 'var(--text2)',
  },
  optionStatus: {
    fontSize: 11,
    color: 'var(--text3)',
    fontWeight: 600,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
  },
  errorBox: {
    margin: '0 24px 14px',
    padding: '10px 12px',
    borderRadius: 10,
    background: 'rgba(196,80,64,0.08)',
    color: 'var(--red)',
    fontSize: 12,
  },
  footer: {
    padding: '12px 24px 18px',
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 8,
    borderTop: '1px solid var(--border)',
  },
  ghostBtn: {
    padding: '10px 16px',
    borderRadius: 8,
    background: 'transparent',
    color: 'var(--text1)',
    border: '1px solid var(--border)',
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
    fontFamily: 'inherit',
    minHeight: 40,
  },
};

const DOT_COLOR: Record<TakeoutChannel, string> = {
  LOCAL: 'var(--gold)',
  DELIVERY_LOCAL: 'var(--green)',
  DELIVERY_APP: 'var(--blue, #2a6ac8)',
};

export function TakeoutChannelPicker({
  open,
  busy,
  error,
  settings,
  onCancel,
  onChoose,
}: Props) {
  const { t } = useTranslation();
  if (!open) return null;
  return (
    <div style={styles.scrim} onClick={() => !busy && onCancel()}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.head}>
          <h3 style={styles.title}>{t('takeout.newTitle')}</h3>
          <div style={styles.sub}>{t('takeout.pickChannel')}</div>
        </div>
        <div style={styles.body}>
          {ALL_TAKEOUT_CHANNELS.map((ch) => {
            const enabled = channelEnabled(settings, ch);
            const disabled = !enabled || !!busy;
            return (
              <button
                key={ch}
                type="button"
                style={optionStyle(disabled)}
                disabled={disabled}
                onClick={() => onChoose(ch)}
              >
                <span style={optionDotStyle(DOT_COLOR[ch])} />
                <span style={styles.optionText}>
                  <span style={styles.optionTitle}>{t(CHANNEL_LABEL_KEY[ch])}</span>
                  <span style={styles.optionHint}>{t(CHANNEL_HINT_KEY[ch])}</span>
                </span>
                {!enabled && <span style={styles.optionStatus}>{t('takeout.disabled')}</span>}
              </button>
            );
          })}
        </div>
        {error && <div style={styles.errorBox}>{error}</div>}
        <div style={styles.footer}>
          <button
            type="button"
            style={styles.ghostBtn}
            onClick={onCancel}
            disabled={busy}
          >
            {t('common.cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}
