#!/usr/bin/env sh
set -eu

if version=$(./node_modules/.bin/biome --version 2>/dev/null) && [ -n "$version" ]; then
  exec ./node_modules/.bin/biome "$@"
fi

if command -v biome >/dev/null 2>&1; then
  version=$(biome --version 2>/dev/null) || version=""
  if [ -n "$version" ]; then
    exec biome "$@"
  fi
fi

if command -v nix >/dev/null 2>&1; then
  exec nix run nixpkgs#biome -- "$@"
fi

echo "biome no está disponible (probaste npm install?)" >&2
exit 1
