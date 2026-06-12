# Agent Guidelines for edge-exchange-plugins

## Build/Test/Lint Commands

- **Test**: `npm test` (single test: `npm test -- test/path/to/file.test.ts`)
- **Lint**: `npm run lint` (auto-fix: `npm run fix`)
- **Type check**: `npm run types`
- **Build**: `npm run prepare` (runs clean, compile, types, and webpack)
- **Verify all**: `npm run verify` (build + lint + types + test)

## Code Style Guidelines

- **TypeScript**: Strict mode enabled, use type imports (`import type { ... }`)
- **Imports**: Sort with `simple-import-sort`, no default exports
- **Formatting**: 2-space indentation, semicolons required, trailing commas
- **Naming**: camelCase for variables/functions, PascalCase for types/interfaces
- **Files**: Use `.ts` extension, organize by feature in `src/swap/`
- **Async**: Always use async/await over promises, handle errors with try/catch
- **Exports**: Named exports only, group related functionality
- **Dependencies**: Use `cleaners` for runtime validation, `biggystring` for numbers
- **Constants**: UPPER_SNAKE_CASE for true constants, extract magic numbers
- **Error handling**: Throw specific Edge error types (e.g., SwapCurrencyError)

## Documentation Index

### Setup & Configuration

- `README.md` - **When to read**: Initial setup, installation, adding exchanges
  - **Summary**: Setup instructions, development guide, PR requirements

### Detailed Documentation

- `docs/conventions/edge-company-conventions.md` - **When to read**: Starting development
  - **Summary**: Company-wide Edge conventions, git workflow, PR rules
- `docs/conventions/typescript-style-guide.md` - **When to read**: Writing new code
  - **Summary**: Import rules, type safety, error handling, naming conventions
- `docs/patterns/swap-plugin-architecture.md` - **When to read**: Creating new plugins
  - **Summary**: Plugin structure, categories, common patterns, best practices
- `docs/business-rules/wallet-validation-rules.md` - **When to read**: Implementing DEX plugins
  - **Summary**: Critical wallet requirements for DEX/DeFi integrations
- `docs/guides/adding-new-exchange.md` - **When to read**: Adding exchange support
  - **Summary**: Step-by-step guide for new exchange integration
- `docs/references/api-deprecations.md` - **When to read**: Seeing deprecation warnings
  - **Summary**: Deprecated APIs, migration paths, impact assessment
