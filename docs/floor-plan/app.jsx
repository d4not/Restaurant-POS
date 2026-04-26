// App: design canvas with all 4 wireframes side by side.

const { useState } = React;

function App() {
  const [section, setSection] = useState({
    overview: {
      title: '4 enfoques para el editor',
      subtitle: 'Wireframes low-fi · zonas y mesas son modificables (mover, resize, eliminar). Compara los enfoques y dime cuál(es) seguir.'
    }
  });

  return (
    <DesignCanvas
      title="Floor Plan Editor — Wireframe Exploration"
      subtitle="POS · zonas movibles · 4 variaciones"
    >
      <DCSection id="overview" title="4 Enfoques al editor">
        <DCArtboard id="w1" label="1. Zonas como contenedores" width={920} height={620}>
          <Wireframe1 />
        </DCArtboard>
        <DCArtboard id="w2" label="2. Canvas libre + toolbar lateral" width={1100} height={620}>
          <Wireframe2 />
        </DCArtboard>
        <DCArtboard id="w3" label="3. Edición / Operación toggle" width={1100} height={620}>
          <Wireframe3 />
        </DCArtboard>
        <DCArtboard id="w4" label="4. Inspector contextual + context menu" width={920} height={620}>
          <Wireframe4 />
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
