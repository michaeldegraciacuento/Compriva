# Compriva frontend

Shared UI for the web management app and the Tauri desktop checkout terminal (`src-tauri/`).

```powershell
npm install
Copy-Item .env.example .env.local
npm run dev            # web app → http://localhost:3000
npm run desktop:dev    # desktop terminal (Tauri window)
```

| Script | Purpose |
| ------ | ------- |
| `npm run lint` / `npm run typecheck` | ESLint / TypeScript |
| `npm test` | Vitest unit tests |
| `npm run test:e2e` | Playwright (starts Laravel + Next.js; DB server must be running) |
| `npm run build` | Web server build |
| `npm run desktop:build` | Desktop installer (static export + Tauri bundle) |

Architecture and rules: [../docs/architecture.md](../docs/architecture.md) and
[../docs/coding-standards.md](../docs/coding-standards.md).
