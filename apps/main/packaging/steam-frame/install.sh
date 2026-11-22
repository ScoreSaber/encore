#!/bin/sh
set -eu

payload="$1"
apps="$HOME/Applications"
data="${XDG_DATA_HOME:-$HOME/.local/share}"

mkdir -p "$apps" "$data/applications" "$data/icons/hicolor/512x512/apps"
cp "$payload/Encore.AppImage" "$apps/Encore.AppImage.new"
chmod +x "$apps/Encore.AppImage.new"
mv "$apps/Encore.AppImage.new" "$apps/Encore.AppImage"
cp "$payload/encore.png" "$data/icons/hicolor/512x512/apps/encore.png"

cat > "$data/applications/com.scoresaber.encore.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=Encore
Comment=Beat Saber companion
Exec=$apps/Encore.AppImage %U
Icon=encore
Terminal=false
Categories=Utility;
MimeType=x-scheme-handler/encore;application/x-beatsaber-playlist;
StartupWMClass=com.scoresaber.encore
Keywords=beat saber;mods;maps;playlists;
DESKTOP

update-desktop-database "$data/applications" 2>/dev/null || true
xdg-mime default com.scoresaber.encore.desktop x-scheme-handler/encore 2>/dev/null || true

setsid "$apps/Encore.AppImage" > /dev/null 2>&1 < /dev/null &
