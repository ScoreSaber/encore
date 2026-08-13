# Setup

## Before Getting Started

While we do our best & pin dependencies to mitigate these problems, modern js development means installing packages from [npm](https://www.npmjs.com/); and frankly Microsofts security standards as of late have been appalling. Supply chain attacks are becoming common enough that you should protect your machine before installing dependencies in any project, including ours

If you haven't already, we strongly urge y'all to harden your shell environment before going forward; it's not difficult, just follow [this](https://gist.github.com/Umbranoxio/84bb7f284ce8250108274f54dafef98b)

## Requirements

### Vite+

Install the Vite+ CLI, which provisions the Node and pnpm versions pinned by this project:

Linux and macOS:

```sh
curl -fsSL https://vite.plus | bash
```

Windows:

```sh
powershell -c "irm https://vite.plus/ps1 | iex"
```

If you already have the pnpm version pinned in `package.json`, Vite+ doesn’t need to be installed globally:

```sh
pnpm install
pnpm exec vp dev
```

`pnpm install` installs the project-local Vite+ CLI. The global CLI is recommended because it also manages the pinned Node and pnpm versions

## Run Encore

Install dependencies:

```sh
vp install
```

Start the app:

```sh
vp dev
```

Preview a production build:

```sh
vp build
vp run start
```

Create an unpacked app directory:

```sh
vp run package:dir
```

The website has separate development and static build tasks:

```sh
vp run dev:web
vp run build:web
vp run start:web
```

## Checks

```sh
vp check
vp run verify
```
