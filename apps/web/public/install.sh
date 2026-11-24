#!/bin/sh
set -eu

fail() {
  echo "$1" >&2
  exit 1
}

download() {
  url="$(curl -fsSL https://api.github.com/repos/ScoreSaber/encore/releases/latest | grep -o "https://[^\"]*$1" | head -n 1)"
  [ -n "$url" ] || fail "Couldn't find the latest Encore release"
  echo "Downloading ${url##*/}"
  curl -fL --progress-bar -o "$2" "$url"
}

install_macos() {
  arch=x64
  if [ "$(sysctl -n hw.optional.arm64 2>/dev/null)" = 1 ]; then arch=arm64; fi

  download "-macos-$arch\.zip" "$work/Encore.zip"
  ditto -x -k "$work/Encore.zip" "$work"

  apps=/Applications
  [ -w "$apps" ] || apps="$HOME/Applications"
  mkdir -p "$apps"
  rm -rf "$apps/Encore.app"
  mv "$work/Encore.app" "$apps/Encore.app"

  echo "Encore is installed. Launching it now"
  open "$apps/Encore.app"
}

install_linux() {
  apps="$HOME/Applications"
  data="${XDG_DATA_HOME:-$HOME/.local/share}"
  appimage="$apps/Encore.AppImage"

  mkdir -p "$apps" "$data/applications" "$data/icons/hicolor/512x512/apps"

  if [ $# -gt 0 ]; then
    cp "$1/Encore.AppImage" "$appimage.new"
  else
    case "$(uname -m)" in
      x86_64) arch=x86_64 ;;
      aarch64) arch=arm64 ;;
      *) fail "Encore doesn't support $(uname -m) yet" ;;
    esac
    download "-linux-$arch\.AppImage" "$appimage.new"
  fi

  chmod +x "$appimage.new"
  (cd "$work" && "$appimage.new" --appimage-extract usr/share/icons/hicolor/1024x1024/apps/encore.png > /dev/null)
  cp "$work/squashfs-root/usr/share/icons/hicolor/1024x1024/apps/encore.png" "$data/icons/hicolor/512x512/apps/encore.png"
  mv "$appimage.new" "$appimage"

  cat > "$data/applications/com.scoresaber.encore.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=Encore
Comment=Beat Saber companion
Exec=env APPIMAGE_EXTRACT_AND_RUN=1 "$appimage" %U
Icon=encore
Terminal=false
Categories=Utility;
MimeType=x-scheme-handler/encore;application/x-beatsaber-playlist;
StartupWMClass=com.scoresaber.encore
Keywords=beat saber;mods;maps;playlists;
DESKTOP

  update-desktop-database "$data/applications" 2>/dev/null || true
  xdg-mime default com.scoresaber.encore.desktop x-scheme-handler/encore 2>/dev/null || true

  echo "Encore is installed. Launching it now"
  APPIMAGE_EXTRACT_AND_RUN=1 setsid "$appimage" > /dev/null 2>&1 < /dev/null &
}

main() {
  work="$(mktemp -d)"
  trap 'rm -rf "$work"' EXIT

  case "$(uname -s)" in
    Darwin) install_macos ;;
    Linux) install_linux "$@" ;;
    *) fail "This script installs Encore on Linux and macOS. For Windows, download Encore from https://encore.scoresaber.com" ;;
  esac
}

main "$@"
