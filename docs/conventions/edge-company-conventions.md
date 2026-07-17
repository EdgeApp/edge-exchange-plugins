# Edge Company Conventions

**Date**: 2025-08-20

## Overview

This document references the company-wide Edge development conventions that apply to all Edge projects, including edge-exchange-plugins.

## Edge Conventions Repository

The official Edge conventions are maintained at: https://github.com/EdgeApp/edge-conventions

### Key Convention Categories

1. **Code Conventions**

   - [JavaScript Code Conventions](https://github.com/EdgeApp/edge-conventions/blob/master/code/javascriptCode.md)
   - [JavaScript Project Setup](https://github.com/EdgeApp/edge-conventions/blob/master/code/javascriptSetup.md)
   - [React Conventions](https://github.com/EdgeApp/edge-conventions/blob/master/code/react.md)
   - [Redux Conventions](https://github.com/EdgeApp/edge-conventions/blob/master/code/redux.md)

2. **Git Conventions**

   - [Commit Rules](https://github.com/EdgeApp/edge-conventions/blob/master/git/commit.md)
   - [Pull Request Rules](https://github.com/EdgeApp/edge-conventions/blob/master/git/pr.md)
   - [Git "Future Commit" Workflow](https://github.com/EdgeApp/edge-conventions/blob/master/git/future-commit.md)

3. **Documentation Standards**
   - [Documentation Conventions](https://github.com/EdgeApp/edge-conventions/blob/master/docs.md)

## How These Apply to edge-exchange-plugins

### Code Standards

While edge-exchange-plugins uses TypeScript (not plain JavaScript), many principles from the JavaScript conventions still apply:

- Consistent formatting and style
- Clear naming conventions
- Proper error handling patterns

### Git Workflow

All Edge projects follow the same git conventions:

- **Commit messages** should follow the Edge commit rules
- **Pull requests** must meet the PR requirements
- **Branching** follows the documented patterns

### Additional Project-Specific Conventions

This project extends the Edge conventions with TypeScript-specific rules documented in:

- [TypeScript Style Guide](./typescript-style-guide.md) - Project-specific TypeScript conventions

## Important Notes

1. **Company conventions take precedence** - When in doubt, follow the Edge conventions
2. **TypeScript additions** - This project adds TypeScript-specific rules on top of the base conventions
3. **PR requirements** - All PRs must follow both Edge conventions and project-specific requirements

## Quick Reference

For edge-exchange-plugins developers:

1. Read the [Edge conventions](https://github.com/EdgeApp/edge-conventions) first
2. Then read our [TypeScript Style Guide](./typescript-style-guide.md) for project-specific rules
3. Follow the [PR rules](https://github.com/EdgeApp/edge-conventions/blob/master/git/pr.md) when submitting changes
