import { Button } from './Button';
import { downloadCsv } from '../../utils/csv';
import { useTranslation } from '../../i18n';

interface CSVExportButtonProps {
  filename: string;
  /** Build the rows lazily so we don't serialize on every render. */
  buildRows: () => ReadonlyArray<ReadonlyArray<unknown>>;
  disabled?: boolean;
}

export function CSVExportButton({ filename, buildRows, disabled }: CSVExportButtonProps) {
  const { t } = useTranslation();
  return (
    <Button
      variant="secondary"
      size="sm"
      disabled={disabled}
      onClick={() => downloadCsv(filename, buildRows())}
      title={t('reports.exportCsvTitle')}
    >
      ⬇ {t('reports.exportCsv')}
    </Button>
  );
}
