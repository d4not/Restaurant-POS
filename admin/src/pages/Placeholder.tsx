import { Card, EmptyState } from '../components/ui';

interface PlaceholderProps {
  title: string;
  description?: string;
}

/**
 * Stand-in for sections that will be built in upcoming frontend phases.
 * Keeps the layout, sidebar, and breadcrumb flowing correctly.
 */
export function Placeholder({ title, description }: PlaceholderProps) {
  return (
    <Card>
      <EmptyState
        icon="🚧"
        message={<span style={{ fontFamily: "'Playfair Display', serif", fontSize: 18 }}>{title}</span>}
        sub={description ?? 'Section under construction — coming in a later phase.'}
      />
    </Card>
  );
}
