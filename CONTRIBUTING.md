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

## React & UI

- Prefer existing shared ScoreSaber UI components when they fit Encore without dragging in website-only behavior
- Use the existing shadcn/ui components in `src/components/ui` before creating raw controls
- Use semantic design tokens and helpers instead of hardcoded colors
- Put user facing text in `messages` and read it with `useTranslations`

## Desktop UX

- Design for Windows and Linux first
- Keep macOS runnable, especially for remote Beat Saber install workflows
- Use clear empty, loading, error and permission states for filesystem and network operations

## Electron

- Keep renderer code behind the typed preload bridge
- Do not import Electron or Node APIs from renderer routes, UI components or shared renderer code
- Keep expected fallible desktop flows in `Result` helpers instead of scattered `try`/`catch`
- Keep filesystem access, process state and native integrations in the main process

## Commits

Our commit style is `{feature}: {change_summary} (#{issue_number})` <sub>(sometimes maintainers are naughty and bypass the need for an issue number, do not be like the maintainers)</sub>

Example:

```text
rank-request: fix comment wrapping (#55)
denyah: destroy the page some more (#1)
```
