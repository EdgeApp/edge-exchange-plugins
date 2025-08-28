# Agent Guidelines for Edge Exchange Plugins

## Build/Test/Lint Commands

- **Test**: `npm test` (single test: `mocha test/path/to/file.test.ts`)
- **Lint**: `npm run lint` (auto-fix: `npm run fix`)
- **Type check**: `npm run types`
- **Build**: `npm run prepare` (compiles TypeScript, runs webpack)
- **Verify all**: `npm run verify` (runs build, lint, types, and tests)
- **Pre-commit**: Automatically runs via Husky hooks

## Code Style Guidelines

- **TypeScript**: Strict mode enabled, target ES2015, module ES2020
- **Imports**: Use simple-import-sort, group by external/internal/relative
- **Formatting**: Prettier via eslint-config-standard-kit, 2-space indent, semicolons
- **Naming**: camelCase for variables/functions, PascalCase for types/interfaces
- **Exports**: Named exports preferred, avoid default exports
- **Error handling**: Throw descriptive Error objects with context
- **Async**: Use async/await over promises, handle errors with try/catch
- **Types**: Leverage edge-core-js types (EdgeCurrencyWallet, EdgeTokenId, etc.)
- **Constants**: UPPER_SNAKE_CASE for true constants
- **Comments**: JSDoc for public APIs, inline comments sparingly for complex logic
