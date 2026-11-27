#!/usr/bin/env bash
# Stages what '--target web' reads of the libraries into an install: libs/<name>/js and the library sources that
# js/shared.txt names. djinnc looks for them in <runtime>/../libs.
set -eu
dest="${1:?usage: package_web_libs.sh <install folder>}"
mkdir -p "$dest"
dest="$(cd "$dest" && pwd)"
cd "$(dirname "$0")/.."

for js in libs/*/js; do
    folder="$(dirname "$js")"
    mkdir -p "$dest/$folder"
    cp -r "$js" "$dest/$folder/"
    [ -f "$js/shared.txt" ] || continue
    tr -d '\r' < "$js/shared.txt" | while IFS= read -r source || [ -n "$source" ]; do
        [ -n "$source" ] || continue
        mkdir -p "$dest/$folder/$(dirname "$source")"
        cp "$folder/$source" "$dest/$folder/$source"
    done
done
