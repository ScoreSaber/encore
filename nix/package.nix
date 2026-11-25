{
  lib,
  stdenv,
  mkPnpmPackage,
  makeBinaryWrapper,
  makeWrapper,
  makeDesktopItem,
  copyDesktopItems,
  electron_43,
  pnpm_11,
  nodejs_24,
  imagemagick,
  rev ? "unknown",
}:
let
  electron = electron_43;
  baseVersion = (lib.importJSON ../apps/main/package.json).version;
  version = "${baseVersion}+${rev}";

  src = lib.fileset.toSource {
    root = ../.;
    fileset = lib.fileset.unions [
      ../package.json
      ../pnpm-lock.yaml
      ../pnpm-workspace.yaml
      ../apps/main
      ../assets
    ];
  };
in
mkPnpmPackage {
  pname = "encore";
  inherit version src;

  nodejs = nodejs_24;
  pnpm = pnpm_11;

  workspace = src;
  components = [ "apps/main" ];
  pnpmLockYaml = ../pnpm-lock.yaml;
  pnpmWorkspaceYaml = ../pnpm-workspace.yaml;

  extraNativeBuildInputs =
    lib.optionals stdenv.hostPlatform.isLinux [
      imagemagick
      copyDesktopItems
      # we use a script wrapper here for environment variable expansion at runtime
      # https://github.com/NixOS/nixpkgs/issues/172583
      makeWrapper
    ]
    ++ lib.optionals stdenv.hostPlatform.isDarwin [
      # on macos we don't need to expand variables, so we can use the faster binary wrapper
      makeBinaryWrapper
    ];

  env = {
    ELECTRON_SKIP_BINARY_DOWNLOAD = 1;
    pnpm_config_pm_on_fail = "ignore";
  };

  preBuild = ''
    # electron builds must be writable
    cp -r ${electron.dist} electron-dist
    chmod -R u+w electron-dist
  '';

  buildPhase = ''
    cd apps/main
    runHook preBuild

    pnpm build
    pnpm run build:watchdog
    pnpm exec electron-builder \
      --dir \
      -c.electronDist=electron-dist \
      -c.electronVersion=${electron.version} \
      ${lib.optionalString stdenv.hostPlatform.isDarwin "-c.mac.identity=null"} # disable code signing on macos, https://github.com/electron-userland/electron-builder/blob/77f977435c99247d5db395895618b150f5006e8f/docs/code-signing.md#how-to-disable-code-signing-during-the-build-process-on-macos

    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall
  ''
  + lib.optionalString stdenv.hostPlatform.isLinux ''
    mkdir -p $out/opt/Encore/
    cp -r release/*unpacked/resources $out/opt/Encore/

    for size in 16 24 32 48 64 128 256 512; do
      mkdir -p $out/share/icons/hicolor/"$size"x"$size"/apps
      magick -background none ${../assets/encore-icon.png} -resize "$size"x"$size" $out/share/icons/hicolor/"$size"x"$size"/apps/encore.png
    done
  ''
  + lib.optionalString stdenv.hostPlatform.isDarwin ''
    mkdir -p $out/{Applications,bin}
    mv release/mac*/Encore.app $out/Applications/Encore.app
  ''
  + ''
    runHook postInstall
  '';

  postFixup =
    lib.optionalString stdenv.hostPlatform.isLinux ''
      makeWrapper ${electron}/bin/electron $out/bin/encore \
        --set ELECTRON_FORCE_IS_PACKAGED 1 \
        --set ENCORE_EXECUTABLE $out/bin/encore \
        --add-flags $out/opt/Encore/resources/app.asar
    ''
    + lib.optionalString stdenv.hostPlatform.isDarwin ''
      makeWrapper $out/Applications/Encore.app/Contents/MacOS/Encore $out/bin/encore
    '';

  desktopItems = lib.optionals stdenv.hostPlatform.isLinux (makeDesktopItem {
    name = "com.scoresaber.encore";
    desktopName = "Encore";
    startupWMClass = "com.scoresaber.encore";
    comment = "Beat Saber companion";
    icon = "encore";
    exec = "encore %U";
    categories = [ "Utility" ];
    mimeTypes = [
      "x-scheme-handler/encore"
      "application/x-beatsaber-playlist"
    ];
    keywords = [
      "beat saber"
      "mods"
      "maps"
      "playlists"
    ];
  });

  meta = {
    description = "A lightweight desktop companion for managing Beat Saber installs, mods and other user generated content";
    homepage = "https://encore.scoresaber.com";
    changelog = "https://github.com/ScoreSaber/encore/releases/tag/v${baseVersion}";
    license = lib.licenses.gpl3Only;
    mainProgram = "encore";
    platforms = [
      "x86_64-linux"
      "aarch64-linux"
      "aarch64-darwin"
    ];
  };
}
