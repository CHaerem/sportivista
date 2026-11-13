{
  # The dev environment for agents and people: `nix develop` gives the tools
  # CLAUDE.md and the workflows assume. Xcode itself is not here — it comes
  # from the machine (xcode-select), because nixpkgs cannot ship it.
  description = "Sportivista dev shell";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";

  outputs = { nixpkgs, ... }:
    let
      systems = [ "aarch64-darwin" "x86_64-darwin" "x86_64-linux" "aarch64-linux" ];
      forAll = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
    in
    {
      devShells = forAll (pkgs: {
        default = pkgs.mkShellNoCC {
          packages = [
            # CI pins node 22 (.github/workflows/ci.yml). The Claude hooks in
            # .claude/settings.json also run on node.
            pkgs.nodejs_22
            # `npm run dev` serves docs/ with python3 -m http.server.
            pkgs.python3
          ] ++ pkgs.lib.optionals pkgs.stdenv.hostPlatform.isDarwin [
            # ios/Sportivista.xcodeproj is generated from ios/project.yml.
            pkgs.xcodegen
          ];
          shellHook = ''
            # nixpkgs' darwin stdenv points DEVELOPER_DIR at its own SDK;
            # xcodebuild must use the Xcode xcode-select names.
            unset DEVELOPER_DIR SDKROOT
          '';
        };
      });
    };
}
