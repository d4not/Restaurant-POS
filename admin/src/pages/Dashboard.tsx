import { Card, KPICard, EmptyState } from '../components/ui';

export function DashboardPage() {
  return (
    <>
      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <KPICard label="Sales today"         value="—" sub="Awaiting data" accent />
        <KPICard label="Orders today"        value="—" sub="Awaiting data" />
        <KPICard label="Average ticket"      value="—" sub="Awaiting data" />
        <KPICard label="Low stock supplies"  value="—" sub="Awaiting data" />
      </div>

      <div className="section-grid-3">
        <Card title="Sales last 7 days">
          <EmptyState icon="📈" message="Chart pending" sub="Will be wired up in frontend Phase 5." />
        </Card>
        <Card title="Stock alerts">
          <EmptyState icon="🔔" message="No alerts" sub="All good — for now." />
        </Card>
      </div>

      <div className="mt-16">
        <Card title="Recent orders">
          <EmptyState icon="🧾" message="No orders yet" sub="The last 10 orders will appear here." />
        </Card>
      </div>
    </>
  );
}
