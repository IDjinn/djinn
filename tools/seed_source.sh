#!/usr/bin/env bash
set -eu
dest="${1:?usage: seed_source.sh <dest>}"
root="$(cd "$(dirname "$0")/.." && pwd)"
rm -rf "$dest"
mkdir -p "$dest"
tar -C "$root/djinnc" --exclude='*_test.djinn' --exclude=build -cf - djinn.proj src | tar -C "$dest" -xf -
