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
      inherit (nixpkgs.lib) genAttrs;

      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "aarch64-darwin"
      ];

      rev = self.shortRev or self.dirtyShortRev or "unknown";

      mkPnpmPackage = f: f.callPackage "${pnpm2nix}/derivation.nix" { };

      forEachSystem =
        perSystem:
        genAttrs systems (
          system:
          let
            pkgs = nixpkgs.legacyPackages.${system};
          in
          perSystem { inherit pkgs system; }
        );
    in
    {
      formatter = forEachSystem ({ pkgs, ... }: pkgs.nixfmt-tree);

      overlays.default = final: prev: {
        encore = final.callPackage ./nix/package.nix {
          inherit rev;
          inherit (mkPnpmPackage final) mkPnpmPackage;
        };
      };

      packages = forEachSystem (
        { pkgs, ... }:
        {
          default = pkgs.callPackage ./nix/package.nix {
            inherit rev;
            inherit (mkPnpmPackage pkgs) mkPnpmPackage;
          };
        }
      );

      devShells = forEachSystem (
        { pkgs, system }:
        {
          default = pkgs.callPackage ./nix/devshell.nix {
            encore = self.packages.${system}.default;
          };
        }
      );
    };
}
