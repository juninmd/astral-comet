# AGENTS.md - Astral Comet

## Tech Stack
- **Runtime:** Chrome/Firefox Extension
- **Language:** TypeScript
- **Bundler:** tsup
- **Dev Server:** web-ext (Firefox)
- **APIs:** Chrome Extensions API, BrasilAPI (FIPE)

## Structure
```
src/             # TypeScript source
dist/            # Built output
manifest.json    # Extension manifest (Chrome + Firefox)
tsup.config.ts   # Bundler config
```

## Commands
- `pnpm install` - Install deps
- `pnpm build` - Build with tsup
- `pnpm dev` - Firefox dev with web-ext
- `pnpm watch` - Watch mode

## Conventions
- TypeScript strict mode
- Cross-browser manifest (Chrome/Firefox compatible)
- CSS injection for UI overlay on target pages
