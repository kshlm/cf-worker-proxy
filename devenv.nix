{pkgs, ...}: {
  cachix = {
    enable = true;
    pull = ["numtide"];
  };
  packages = with pkgs; [
    bun
    typescript-language-server
    wrangler
  ];
}
