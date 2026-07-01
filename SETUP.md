# Setup

## Before Getting Started

While we do our best & pin dependencies to mitigate these problems, modern js development means installing packages from [npm](https://www.npmjs.com/); and frankly Microsofts security standards as of late have been appalling. Supply chain attacks are becoming common enough that you should protect your machine before installing dependencies in any project, including ours

If you haven't already, we strongly urge y'all to harden your shell environment before going forward; it's not difficult, just follow [this](https://gist.github.com/Umbranoxio/84bb7f284ce8250108274f54dafef98b)

## Requirements

### Package Manager

Install Bun:

Linux and macOS:

```sh
curl -fsSL https://bun.sh/install | bash
```

Windows:

```sh
powershell -c "irm bun.sh/install.ps1 | iex"
```

### Runtime

Use Node `24.x`

We recommend [nvm](https://github.com/nvm-sh/nvm#installing-and-updating). From the project root:

```sh
nvm install
nvm use
```

## Run Encore

Install dependencies:

```sh
bun i
```

Start the app:

```sh
bun run dev
```

Preview a production build:

```sh
bun run build
bun run start
```

Create an unpacked app directory:

```sh
bun run package:dir
```

## Checks

IDE extensions and pre-commit hooks should handle most formatting and linting for you. If you want to run the same checks manually:

```sh
bun run lint
bun run format:check
bun run typecheck
```

For behavior, Electron, packaging, filesystem, dependency or install detection changes, a production build is also useful:

```sh
bun run build
```
