#!/usr/bin/env bash
set -eu
here="$(cd "$(dirname "$0")" && pwd)"
djinnc="${1:-${DJINNC:-djinnc}}"
runtime="${2:-$here/../../runtime}"
runtime_lib="${3:?usage: build.sh <djinnc> <runtime dir> <runtime lib>}"
out="$here/build/djinn-scaffold"
extra=()
case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) out="$out.exe";; *) extra=(--link-arg -lm);; esac
mkdir -p "$here/build"
# The default theme is written into new projects as style.css: generated from the ui library's stylesheet.
{
  printf 'import std::types;
namespace scaffold;

struct ThemeCss {
    public static str css() {
        return """
'
  awk '/^struct ThemeSheet/{t=1} t&&/return """/{c=1;next} c&&/^""";/{exit} c{print}' "$here/../../libs/ui/src/style/theme_sheet.djinn"
  printf '""";
    }
}
'
} > "$here/theme_css.djinn"
"$djinnc" "$here" -o "$out" --runtime-dir "$runtime" --runtime-lib "$runtime_lib" "${extra[@]}"
echo "built $out"
