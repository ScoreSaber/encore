{
  lib,
  pkgs,
  encore,
}:
pkgs.mkShell {
  # automatically pulls nativeBuildInputs + buildInputs
  inputsFrom = [ encore ];

  packages = with pkgs; [
    pnpm_11
    nodejs_24
  ];

  # needed for running pnpm install / pnpm dev in the shell
  env = lib.optionalAttrs pkgs.stdenv.hostPlatform.isLinux {
    ELECTRON_SKIP_BINARY_DOWNLOAD = "1";
    ELECTRON_OVERRIDE_DIST_PATH = "${pkgs.electron_43}/bin";
  };
}
