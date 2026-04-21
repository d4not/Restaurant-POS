import { Card, KPICard, EmptyState } from '../components/ui';

export function DashboardPage() {
  return (
    <>
      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <KPICard label="Ventas hoy"       value="—" sub="Esperando datos" accent />
        <KPICard label="Órdenes hoy"      value="—" sub="Esperando datos" />
        <KPICard label="Ticket promedio"  value="—" sub="Esperando datos" />
        <KPICard label="Insumos bajo stock" value="—" sub="Esperando datos" />
      </div>

      <div className="section-grid-3">
        <Card title="Ventas últimos 7 días">
          <EmptyState icon="📈" message="Gráfica pendiente" sub="Se conectará en la Fase 5 del frontend." />
        </Card>
        <Card title="Alertas de stock">
          <EmptyState icon="🔔" message="Sin alertas" sub="Todo en orden — por ahora." />
        </Card>
      </div>

      <div className="mt-16">
        <Card title="Órdenes recientes">
          <EmptyState icon="🧾" message="Sin órdenes aún" sub="Las últimas 10 órdenes aparecerán aquí." />
        </Card>
      </div>
    </>
  );
}
