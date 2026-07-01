# Contributing

For local setup, start with [SETUP.md](SETUP.md)

## Package Management

Use Bun for package work:

```sh
bun i
bun add <package>
bun remove <package>
```

Do not use npm, pnpm or yarn in this repo

## Code Style

- Use kebab-case for TypeScript filenames and directories
- Use named exports
- Omit explicit TypeScript return types when inference is clear
- Keep explicit return types when they make a public contract clearer or inference is weak
- Keep validation at real boundaries like filesystem, network, env, auth/session, generated contracts and remote Beat Saber targets
- Avoid runtime shape guards, casts and `unknown` plumbing for values already constrained by local TypeScript types

## Desktop UX

- Prefer existing shared ScoreSaber UI components when they fit Encore without dragging in website-only behavior
- Design for Windows and Linux first
- Keep macOS runnable, especially for remote Beat Saber install workflows
- Use clear empty, loading, error and permission states for filesystem and network operations

## Commits

Our commit style is `{feature}: {change_summary} (#{issue_number})` <sub>(sometimes maintainers are naughty and bypass the need for an issue number, do not be like the maintainers)</sub>

Example:

```text
rank-request: fix comment wrapping (#55)
denyah: destroy the page some more (#1)
```
