{
  pkgs,
  lib,
  config,
  inputs,
  ...
}: let
  nix-ai-tools = inputs.nix-ai-tools.packages.${pkgs.system};
in {
  cachix = {
    enable = true;
    pull = ["numtide"];
  };
  packages =
    (with pkgs; [
      bun
      typescript-language-server
      wrangler
    ])
    ++ (with nix-ai-tools; [
      codex
      opencode
    ]);
}
