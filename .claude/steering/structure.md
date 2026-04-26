# Project Structure — POS Terminal Mobile

## Full tree

```
Restaurant-POS/                     ← Project root
├── src/                            ← Backend (Express API)
├── admin/                          ← Admin panel (React + Vite)
├── terminal/                       ← Desktop terminal (Electron + React)
│   ├── electron/                   ← Electron main process
│   └── src/                        ← ⭐ SHARED React app code
│       ├── api/                    ← API client
│       ├── components/             ← All UI components
│       ├── hooks/                  ← TanStack Query hooks
│       ├── pages/                  ← Page components
│       ├── platform/               ← ⭐ Platform abstraction (NEW)
│       │   ├── types.ts            ← PlatformBridge interface
│       │   ├── electron.ts         ← Electron implementation
│       │   ├── web.ts              ← Browser fallback
│       │   └── index.ts            ← Platform detection + bridge factory
│       ├── store/                  ← Zustand stores
│       ├── utils/                  ← Formatting utilities
│       ├── App.tsx                 ← Root component
│       └── index.css               ← Design system
├── terminal-mobile/                ← ⭐ Android tablet app (NEW)
│   ├── android/                    ← Generated Android project
│   │   ├── app/
│   │   │   ├── src/main/
│   │   │   │   ├── AndroidManifest.xml
│   │   │   │   └── res/            ← Icons, splash
│   │   │   └── build.gradle
│   │   └── build.gradle
│   ├── src/
│   │   ├── main-mobile.tsx         ← Mobile entry point
│   │   ├── platform/
│   │   │   ├── printer.ts          ← Backend API print adapter
│   │   │   ├── storage.ts          ← Capacitor Preferences adapter
│   │   │   ├── haptics.ts          ← Capacitor Haptics adapter
│   │   │   └── network.ts          ← Capacitor Network adapter
│   │   └── styles/
│   │       └── mobile.css          ← Tablet CSS overrides
│   ├── resources/
│   │   ├── icon.png
│   │   └── splash.png
│   ├── capacitor.config.ts
│   ├── vite.config.ts
│   ├── index.html
│   ├── tsconfig.json
│   └── package.json
├── prisma/                         ← Database schema
├── docs/                           ← Specifications
└── CLAUDE.md                       ← Project-wide rules
```

## Naming conventions
- Files: kebab-case (e.g., `printer-adapter.ts`)
- Components: PascalCase (e.g., `FloorPlan.tsx`)
- Hooks: camelCase with `use` prefix (e.g., `useOrders.ts`)
- Platform adapters: descriptive noun (e.g., `printer.ts`, `storage.ts`)

## Import rules
- Shared code imports: `import { X } from '@/components/...'` (aliased to terminal/src/)
- Mobile-only imports: `import { X } from '@mobile/platform/...'` (aliased to terminal-mobile/src/)
- NEVER import from `@capacitor/*` in terminal/src/ — only in terminal-mobile/src/platform/
- NEVER import from `electron` in terminal/src/ — only in terminal/electron/

## Where new things go
- New shared component → `terminal/src/components/`
- New tablet-only behavior → `terminal-mobile/src/platform/`
- New backend endpoint → `src/modules/<module>/`
- New Capacitor plugin integration → `terminal-mobile/src/platform/` as a new adapter file
