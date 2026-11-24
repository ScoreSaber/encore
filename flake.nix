{
  description = "A lightweight desktop companion for managing Beat Saber installs, mods and other user generated content";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

    pnpm2nix.url = "github:FliegendeWurst/pnpm2nix-nzbr";
    pnpm2nix.inputs.nixpkgs.follows = "nixpkgs";
  };

  outputs =
    {
      self,
      nixpkgs,
      pnpm2nix,
      ...
    }:
    let
      inherit (nixpkgs) lib;
      forEachPkgs =
        f:
        lib.genAttrs [ "x86_64-linux" "aarch64-linux" "aarch64-darwin" ] (
          s: f (nixpkgs.legacyPackages.${s}.extend pnpm2nix.overlays.default)
        );
    in
    {
      formatter = forEachPkgs (pkgs: pkgs.nixfmt-tree);

      packages = forEachPkgs (pkgs: {
        default = pkgs.callPackage ./nix/package.nix { rev = self.shortRev or self.dirtyShortRev or null; };
      });

      checks = forEachPkgs (pkgs: {
        default = self.packages.${pkgs.stdenv.hostPlatform.system}.default;
      });

      devShells = forEachPkgs (
        pkgs:
        let
          inherit (pkgs.stdenv.hostPlatform) isLinux;
          package = self.packages.${pkgs.stdenv.hostPlatform.system}.default;
        in
        {
          default = pkgs.mkShell {
            # automatically pulls nativeBuildInputs + buildInputs
            inputsFrom = [ package ];

            packages = with pkgs; [
              nixfmt

              pnpm_11
              nodejs_24
            ];

            env = lib.optionalAttrs isLinux {
              ELECTRON_SKIP_BINARY_DOWNLOAD = "1";
              ELECTRON_OVERRIDE_DIST_PATH = "${pkgs.electron_43}/bin";
            };
          };
        }
      );
      overlays.default = final: prev: {
        encore = self.packages.${final.stdenv.hostPlatform.system}.default;
      };
    };
}
