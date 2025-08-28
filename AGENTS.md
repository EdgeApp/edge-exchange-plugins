# Edge Exchange Plugins Documentation Index

This index provides a comprehensive overview of all documentation for the Edge Exchange Plugins codebase.

## Quick Reference

### Entry Points

- **[README.md](./README.md)** - Project setup, installation, and quick start guide
  - _When to read_: Initial project setup or when adding to a new Edge application
  - _Summary_: Installation instructions, browser/Node.js/React Native integration

### Agent Guidelines

- **[AGENTS.md](./AGENTS.md)** - This documentation index and coding agent guidelines
  - _When to read_: Starting development or when needing documentation overview
  - _Summary_: Complete documentation map, build commands, code style rules

## Core Documentation

### Conventions

- **[docs/conventions/plugin-development.md](./docs/conventions/plugin-development.md)** - Plugin development standards
  - _When to read_: Before creating or modifying any exchange plugin
  - _Summary_: Directory structure, naming conventions, error handling, type safety, testing patterns

### Architecture & Patterns

- **[docs/patterns/plugin-architecture.md](./docs/patterns/plugin-architecture.md)** - System architecture and design patterns
  - _When to read_: Understanding the overall system design or implementing advanced features
  - _Summary_: Plugin factory pattern, inner/outer plugin architecture, CEX vs DEX patterns, data flow

### Guides

- **[docs/guides/adding-new-plugin.md](./docs/guides/adding-new-plugin.md)** - Step-by-step guide for adding exchange plugins
  - _When to read_: Adding a new exchange integration to the system
  - _Summary_: Complete walkthrough from plugin creation to PR submission, including testing and documentation

### API Reference

- **[docs/references/api-integration.md](./docs/references/api-integration.md)** - API integration reference and utilities
  - _When to read_: Implementing plugin functionality or debugging integration issues
  - _Summary_: Edge Core types, utility functions, validation patterns, DEX/CEX specific implementations

### Business Rules

- **[docs/business-rules/exchange-requirements.md](./docs/business-rules/exchange-requirements.md)** - Exchange integration requirements and rules
  - _When to read_: Ensuring compliance with Edge ecosystem requirements
  - _Summary_: Mandatory rules, security requirements, compliance, performance standards

## Build & Development Commands

### Essential Commands

- **Test**: `npm test` (single test: `mocha test/path/to/file.test.ts`)
- **Lint**: `npm run lint` (auto-fix: `npm run fix`)
- **Type check**: `npm run types`
- **Build**: `npm run prepare` (compiles TypeScript, runs webpack)
- **Verify all**: `npm run verify` (runs build, lint, types, and tests)
- **Pre-commit**: Automatically runs via Husky hooks

## Code Style Guidelines

### TypeScript Configuration

- **Strict mode**: Enabled with all strict checks
- **Target**: ES2015 for broad compatibility
- **Module**: ES2020 for modern module features
- **Resolution**: Node module resolution

### Code Formatting

- **Indentation**: 2 spaces (enforced by Prettier)
- **Semicolons**: Required (enforced by Prettier)
- **Quotes**: Single quotes for strings
- **Line length**: 80 characters preferred, 120 max
- **Trailing commas**: Required in multi-line objects/arrays

### Import Organization

- **Order**: External → Edge Core → Internal utils → Relative
- **Sorting**: Enforced by simple-import-sort plugin
- **Type imports**: Use `import type` when possible

### Naming Conventions

- **Variables/Functions**: camelCase (`fetchSwapQuote`, `nativeAmount`)
- **Types/Interfaces**: PascalCase (`EdgeSwapRequest`, `SwapOrder`)
- **Constants**: UPPER_SNAKE_CASE (`API_URL`, `MAINNET_CODE_TRANSCRIPTION`)
- **Files**: camelCase for source files (`changeNow.ts`)
- **Test files**: `{feature}.test.ts` pattern

### Best Practices

- **Exports**: Named exports preferred, avoid default exports
- **Error handling**: Throw descriptive Error objects with context
- **Async**: Use async/await over promises, handle errors with try/catch
- **Types**: Leverage edge-core-js types (EdgeCurrencyWallet, EdgeTokenId, etc.)
- **Comments**: JSDoc for public APIs, inline comments sparingly for complex logic
- **String amounts**: Always use strings for cryptocurrency amounts to avoid precision loss

## Testing Guidelines

### Test Structure

- **Location**: All tests in `test/` directory
- **Framework**: Mocha with Chai assertions
- **Coverage**: NYC for code coverage reporting
- **Timeout**: Set appropriate timeouts for API calls (30s typical)

### Running Tests

```bash
# Run all tests
npm test

# Run specific test file
mocha test/thorchain.test.ts

# Run with coverage
npm run test:coverage

# Run continuously during development
npm run test:watch
```

## Plugin Categories

### Currently Supported Plugins

#### Centralized Exchanges (CEX)

- ChangeHero (`changehero`)
- ChangeNOW (`changenow`)
- Exolix (`exolix`)
- Godex (`godex`)
- LetsExchange (`letsexchange`)
- SideShift (`sideshift`)
- Swapuz (`swapuz`)

#### Decentralized Exchanges (DEX)

- 0x Gasless (`0xgasless`)
- Cosmos IBC (`cosmosibc`)
- Fantom Sonic Upgrade (`fantomsonicupgrade`)
- LiFi (`lifi`)
- Maya Protocol (`mayaprotocol`)
- Rango (`rango`)
- SpookySwap (`spookySwap`)
- SwapKit (`swapkit`)
- Thorchain (`thorchain`)
- TombSwap (`tombSwap`)
- Unizen (`unizen`)
- Velodrome (`velodrome`)
- XRP DEX (`xrpdex`)

#### Special Purpose

- Transfer (`transfer`) - Direct wallet-to-wallet transfers

## Development Workflow

1. **Setup**: Clone repo, run `yarn` to install dependencies
2. **Development**: Make changes, use `yarn start` for webpack dev server
3. **Testing**: Write tests, run `npm test` to verify
4. **Linting**: Run `npm run fix` to auto-fix style issues
5. **Type Check**: Run `npm run types` to verify TypeScript
6. **Build**: Run `npm run prepare` to build for production
7. **Verify**: Run `npm run verify` for complete validation
8. **Commit**: Husky pre-commit hooks run automatically

## Debugging

### Local Development

- Run `yarn start` for webpack dev server at http://localhost:8083
- Use `debugUri` instead of `pluginUri` in React Native
- Enable verbose logging with `log` function from EdgeCorePluginOptions

### Common Issues

- **Type errors**: Check edge-core-js version compatibility
- **API failures**: Verify API keys in initOptions
- **Test timeouts**: Increase timeout for slow API endpoints
- **Build errors**: Clear `lib/` and `dist/` directories, rebuild

## Contributing

Before submitting a PR:

1. Ensure all tests pass: `npm test`
2. Fix linting issues: `npm run fix`
3. Verify types: `npm run types`
4. Update documentation if needed
5. Include exchange logos for GUI integration
6. Add partner reporting for CEX plugins
