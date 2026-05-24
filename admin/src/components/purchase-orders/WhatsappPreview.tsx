import { useWhatsappLink } from '../../hooks/usePurchases';
import { Button } from '../ui';
import { useTranslation } from '../../i18n';

interface Props {
  purchaseId: string;
}

// Renders a textarea-style preview of the auto-generated WhatsApp message
// plus a one-click "Open WhatsApp" CTA that pops wa.me in a new tab. If the
// supplier has no whatsapp_phone we surface that gap inline so the operator
// edits the supplier instead of staring at a disabled button.
export function WhatsappPreview({ purchaseId }: Props) {
  const { t } = useTranslation();
  const { data, isLoading, error } = useWhatsappLink(purchaseId);

  if (isLoading) {
    return <div className="text-muted">{t('po.whatsapp.loading')}</div>;
  }
  if (error || !data) {
    return <div className="text-red">{t('po.whatsapp.error')}</div>;
  }

  return (
    <div className="po-whatsapp-preview">
      <pre className="po-whatsapp-message" aria-label={t('po.whatsapp.preview')}>
        {data.message}
      </pre>
      {data.requires_phone ? (
        <div className="po-whatsapp-warning text-red fs-12 mt-8">
          {t('po.whatsapp.missingPhone')}
        </div>
      ) : (
        <Button
          variant="primary"
          onClick={() => window.open(data.url!, '_blank', 'noopener,noreferrer')}
        >
          {t('po.whatsapp.openCta')}
        </Button>
      )}
    </div>
  );
}
