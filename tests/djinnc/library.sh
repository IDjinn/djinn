#!/usr/bin/env bash
# Library (.djlib) checks: no source text in the file, generics/constexpr/macros/proc macros/private/sync/reflection across
# the boundary, the format guards, and inlining across the boundary for every library optimization level.
set -eu
compiler="${1:?usage: library.sh <djinnc> [runtime lib] [runtime dir]}"
runtime_lib="${2:-}"
runtime="${3:-runtime}"
root="$(cd "$(dirname "$0")/../.." && pwd)"
out="$root/build/unit/library"
rm -rf "$out"
mkdir -p "$out"
cd "$root"
flags=(--runtime-dir "$runtime")
if [ -n "$runtime_lib" ]; then
    flags+=(--runtime-lib "$runtime_lib")
fi
if [ -n "${DJINN_USE_LLD:-}" ]; then
    flags+=(--lld)
fi
exe=""
case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) exe=".exe" ;; esac

fail() { echo "FAIL library: $1"; exit 1; }

sample="$root/tests/djinnc/library"

# --- the sample: a library with a macro, generics, constexpr, reflection, and an app that exits with 35
"$compiler" "$sample/mathlib.djinn" --library -o "$out/mathlib.djlib" "${flags[@]}" > "$out/mathlib.log" 2>&1 || { cat "$out/mathlib.log"; fail "the sample library must build"; }
"$compiler" --inspect-lib "$out/mathlib.djlib" > "$out/mathlib.inspect" || fail "--inspect-lib must work"
grep -q "integrity:  ok" "$out/mathlib.inspect" || fail "--inspect-lib must report the integrity"
grep -q "bitcode:" "$out/mathlib.inspect" || fail "--inspect-lib must list the bitcode line"
"$compiler" --inspect-lib "$out/mathlib.djlib" --sections-only > "$out/mathlib.brief"
if grep -q "// ----" "$out/mathlib.brief"; then fail "--sections-only must not dump the interface"; fi
grep -q "interface:" "$out/mathlib.brief" || fail "--sections-only must list the sections"
if grep -q "secret implementation detail" "$out/mathlib.djlib"; then fail "the library must not contain comments"; fi
if grep -q "namespace mathlib;" "$out/mathlib.djlib"; then fail "the library must not contain source text"; fi
"$compiler" "$sample/app.djinn" --lib "$out/mathlib.djlib" -o "$out/app$exe" "${flags[@]}" > "$out/app.log" 2>&1 || { cat "$out/app.log"; fail "the app must build against the library"; }
status=0
"$out/app$exe" > /dev/null || status=$?
[ "$status" = "$(cat "$sample/app.exit")" ] || fail "the app must exit with $(cat "$sample/app.exit"), got $status"

# --- format guards: a greater version and an interface of another build are refused
python_patch() {
    # $1 input, $2 output, $3 offset, $4 hex byte
    printf '%s' "$4" | xxd -r -p | dd of="$2" bs=1 seek="$3" conv=notrunc status=none
}
cp "$out/mathlib.djlib" "$out/future.djlib"
python_patch "$out/mathlib.djlib" "$out/future.djlib" 8 "02"
if "$compiler" "$sample/app.djinn" --lib "$out/future.djlib" -o "$out/future$exe" "${flags[@]}" > "$out/future.log" 2>&1; then fail "a greater format version must be rejected"; fi
grep -q "unsupported library version" "$out/future.log" || { cat "$out/future.log"; fail "a greater format version must say so"; }

# version policy: another major.minor is refused (build it again), another patch is accepted
cp "$out/mathlib.djlib" "$out/minor.djlib"
python_patch "$out/mathlib.djlib" "$out/minor.djlib" 29 "02"
python_patch "$out/mathlib.djlib" "$out/minor.djlib" 104 "0000000000000000"  # unseal: this test is about the version policy
if "$compiler" "$sample/app.djinn" --lib "$out/minor.djlib" -o "$out/minor$exe" "${flags[@]}" > "$out/minor.log" 2>&1; then fail "a library of another compiler version must be rejected"; fi
grep -q "written by djinnc 0.2.0" "$out/minor.log" || { cat "$out/minor.log"; fail "the version message must name the compiler that wrote the library"; }
cp "$out/mathlib.djlib" "$out/patch.djlib"
python_patch "$out/mathlib.djlib" "$out/patch.djlib" 28 "07"
python_patch "$out/mathlib.djlib" "$out/patch.djlib" 104 "0000000000000000"  # unseal: this test is about the version policy
"$compiler" "$sample/app.djinn" --lib "$out/patch.djlib" -o "$out/patch$exe" "${flags[@]}" > "$out/patch.log" 2>&1 || { cat "$out/patch.log"; fail "a library of another patch version must be accepted"; }
# interface hash: a header that names another interface marks the library stale
"$compiler" --inspect-lib "$out/mathlib.djlib" --sections-only | grep -q "interface hash:" || fail "--inspect-lib must show the interface hash"
cp "$out/mathlib.djlib" "$out/stale.djlib"
python_patch "$out/mathlib.djlib" "$out/stale.djlib" 96 "7a7b"
if "$compiler" "$sample/app.djinn" --lib "$out/stale.djlib" -o "$out/stale$exe" "${flags[@]}" > "$out/stale.log" 2>&1; then fail "a stale interface hash must be rejected"; fi
grep -qE "is stale|corrupted" "$out/stale.log" || { cat "$out/stale.log"; fail "a stale library must say so"; }

# header hash: the header and the section table are sealed, so a change to either is refused
"$compiler" --inspect-lib "$out/mathlib.djlib" --sections-only | grep -q "header hash: *ok" || fail "--inspect-lib must show an intact header hash"
cp "$out/mathlib.djlib" "$out/sealed.djlib"
python_patch "$out/mathlib.djlib" "$out/sealed.djlib" 40 "7a"
if "$compiler" "$sample/app.djinn" --lib "$out/sealed.djlib" -o "$out/sealed$exe" "${flags[@]}" > "$out/sealed.log" 2>&1; then fail "a changed header must be rejected"; fi
grep -q "header or section table" "$out/sealed.log" || { cat "$out/sealed.log"; fail "a changed header must say so"; }
"$compiler" --inspect-lib "$out/sealed.djlib" --sections-only | grep -q "DAMAGED" || fail "--inspect-lib must flag a damaged header"

# compression: interface and bitcode are stored as LZ4 blocks, --no-compress keeps them raw, a damaged one is refused
"$compiler" --inspect-lib "$out/mathlib.djlib" | grep -q "stored: .* bytes (lz4)" || fail "the interface and bitcode of a library must be stored compressed"
"$compiler" "$sample/mathlib.djinn" --library --no-compress -o "$out/raw.djlib" "${flags[@]}" > "$out/raw.log" 2>&1 || { cat "$out/raw.log"; fail "library --no-compress must build"; }
if "$compiler" --inspect-lib "$out/raw.djlib" | grep -q "(lz4)"; then fail "--no-compress must store the sections raw"; fi
[ "$(stat -c %s "$out/raw.djlib")" -gt "$(stat -c %s "$out/mathlib.djlib")" ] || fail "the compressed library must be smaller than the raw one"
"$compiler" "$sample/app.djinn" --lib "$out/raw.djlib" -o "$out/raw_app$exe" "${flags[@]}" > "$out/raw_app.log" 2>&1 || { cat "$out/raw_app.log"; fail "an app must build against a raw library"; }
size=$(stat -c %s "$out/mathlib.djlib")
cp "$out/mathlib.djlib" "$out/damaged.djlib"
python_patch "$out/mathlib.djlib" "$out/damaged.djlib" $((size - 3)) "5a5a5a"
if "$compiler" "$sample/app.djinn" --lib "$out/damaged.djlib" -o "$out/damaged$exe" "${flags[@]}" > "$out/damaged.log" 2>&1; then fail "a damaged compressed section must be rejected"; fi
grep -q "corrupted" "$out/damaged.log" || { cat "$out/damaged.log"; fail "a damaged compressed section must say corrupted"; }

# --- features across the boundary
cat > "$out/features_lib.djinn" <<'SOURCE'
namespace featurelib;

[Reflect]
struct Pair<T> {
    T first;
    T second;

    public T sum() {
        return this.first + this.second;
    }
}

[Reflect]
struct Plain {
    i32 value;
}

constexpr i32 triple_const(i32 x) {
    return x * 3;
}

macro negate {
    (expression v) => { 0 - v }
}

T biggest<T>(T a, T b) {
    if (a > b) {
        return a;
    }
    return b;
}

public sync i32 blocking(i32 x) {
    return x + 1;
}

public async i32 asynchronous(i32 x) {
    return x + 2;
}

private i32 hidden(i32 x) {
    return x;
}

public i32 shown(i32 x) {
    return hidden(x) + 1;
}
SOURCE
cat > "$out/features_app.djinn" <<'SOURCE'
namespace app;
import featurelib;

extern "C" {
    i32 printf(ptr<i8> format, ...);
}

unsafe i32 main() {
    const i32 FIXED = triple_const(4);
    Pair<i32> p = { .first = 3, .second = 4 };
    i32 a = p.sum() + biggest(2, 9) + negate(5) + FIXED + shown(1);
    i32 b = blocking(1) + await asynchronous(1);
    printf("%d %d %d %d\n", a, b, Reflection.type_count(), typeof(Plain).id);
    return 0;
}
SOURCE
"$compiler" "$out/features_lib.djinn" --library --reflect-all -o "$out/features.djlib" "${flags[@]}" > "$out/features_lib.log" 2>&1 || { cat "$out/features_lib.log"; fail "feature library must build"; }
"$compiler" "$out/features_app.djinn" --lib "$out/features.djlib" --reflect-all -o "$out/features_lib_app$exe" "${flags[@]}" > "$out/features_a.log" 2>&1 || { cat "$out/features_a.log"; fail "feature app must build against the library"; }
"$compiler" "$out/features_lib.djinn" "$out/features_app.djinn" --reflect-all -o "$out/features_src_app$exe" "${flags[@]}" > "$out/features_b.log" 2>&1 || { cat "$out/features_b.log"; fail "feature app must build from source"; }
"$out/features_lib_app$exe" > "$out/features_lib.out" || fail "library build must run"
"$out/features_src_app$exe" > "$out/features_src.out" || fail "source build must run"
cmp -s "$out/features_lib.out" "$out/features_src.out" || { cat "$out/features_lib.out" "$out/features_src.out"; fail "generics, constexpr, macros, reflection and TypeInfo ids must match the source build"; }

cat > "$out/private_use.djinn" <<'SOURCE'
namespace app;
import featurelib;

i32 main() {
    return hidden(1);
}
SOURCE
if "$compiler" "$out/private_use.djinn" --lib "$out/features.djlib" -o "$out/private_use$exe" "${flags[@]}" > "$out/private_use.log" 2>&1; then fail "a private function of a library must not be callable"; fi
grep -q "E3062" "$out/private_use.log" || { cat "$out/private_use.log"; fail "private access through a library must report E3062"; }

cat > "$out/sync_use.djinn" <<'SOURCE'
namespace app;
import featurelib;

i32 main() {
    return await blocking(1);
}
SOURCE
if "$compiler" "$out/sync_use.djinn" --lib "$out/features.djlib" -o "$out/sync_use$exe" "${flags[@]}" > "$out/sync_use.log" 2>&1; then fail "awaiting a sync function of a library must be rejected"; fi

# --- procedural macros keep running from the library object (needs std)
std_dir="$root/build/unit/libs"
if [ -f "$std_dir/std.djlib" ]; then
    cat > "$out/proc_lib.djinn" <<'SOURCE'
import std::meta;
namespace demo;

TokenStream expand_double(TokenStream input) {
    mut TokenStream out = TokenStream.create();
    out.push(Token.open("("));
    out.append(input);
    out.push(Token.close(")"));
    out.push(Token.punct("*"));
    out.push(Token.number("2"));
    return out;
}

proc macro double => expand_double;
SOURCE
    cat > "$out/proc_app.djinn" <<'SOURCE'
import demo;

i32 main() {
    return double!(3 + 4) + double!{1};
}
SOURCE
    std_flags=("${flags[@]}" --lib-dir "$std_dir" --std-dir "$root/std" --std)
    "$compiler" "$out/proc_lib.djinn" --library -o "$out/demo.djlib" "${std_flags[@]}" > "$out/proc_lib.log" 2>&1 || { cat "$out/proc_lib.log"; fail "proc macro library must build"; }
    "$compiler" "$out/proc_app.djinn" --lib "$out/demo.djlib" -o "$out/proc_app$exe" "${std_flags[@]}" > "$out/proc_app.log" 2>&1 || { cat "$out/proc_app.log"; fail "proc macro app must build"; }
    status=0
    "$out/proc_app$exe" || status=$?
    [ "$status" = 16 ] || fail "the proc macro must expand from the library (exit 16, got $status)"
fi

# --- inlining across the boundary: the library at every level, the consumer with and without -g
cat > "$out/fastlib.djinn" <<'SOURCE'
namespace fastlib;

public i32 triple(i32 x) {
    return x * 3 + 1;
}
SOURCE
cat > "$out/fastapp.djinn" <<'SOURCE'
namespace app;
import fastlib;

extern "C" {
    i32 rand();
}

i32 main() {
    return triple(rand()) & 1;
}
SOURCE
build_fast() { # <name> <library flags...>
    name="$1"; shift
    "$compiler" "$out/fastlib.djinn" --library -o "$out/$name.djlib" "$@" "${flags[@]}" > "$out/$name.log" 2>&1 || { cat "$out/$name.log"; fail "library $name must build"; }
    "$compiler" --inspect-lib "$out/$name.djlib" | grep -q "bitcode: " || fail "library $name must have a bitcode section"
}
build_fast fast_o0 -O0
build_fast fast_o3 -O3
build_fast fast_g -O0 -g
build_fast fast_o3g -O3 -g
inlined() { # <library> <consumer flags...>: 0 when the call to triple is gone from the optimized IR
    lib="$1"; shift
    "$compiler" "$out/fastapp.djinn" --lib "$out/$lib.djlib" --emit-ir -o "$out/ir_$lib" "$@" "${flags[@]}" > "$out/ir.log" 2>&1 || { cat "$out/ir.log"; fail "consumer of $lib must compile"; }
    if grep -q "call .*triple" "$out/ir_$lib.ll"; then return 1; fi
    return 0
}
for lib in fast_o0 fast_o3 fast_g fast_o3g; do
    inlined "$lib" -O3 || fail "$lib: a consumer at -O3 must inline the library function"
    inlined "$lib" -O3 -g || fail "$lib: a consumer at -O3 -g must inline the library function"
    if inlined "$lib" -O0; then fail "$lib: a consumer at -O0 must not inline"; fi
    if inlined "$lib" -O3 --tiered; then fail "$lib: a --tiered consumer must not inline"; fi
done
# the bitcode of a -g library carries no debug bookkeeping: about the size of the one without -g
plain=$("$compiler" --inspect-lib "$out/fast_o0.djlib" --sections-only | grep -o 'bitcode: *[0-9]*' | grep -o '[0-9]*$')
debug=$("$compiler" --inspect-lib "$out/fast_g.djlib" --sections-only | grep -o 'bitcode: *[0-9]*' | grep -o '[0-9]*$')
[ $((debug * 10)) -le $((plain * 12)) ] && [ $((plain * 10)) -le $((debug * 12)) ] || fail "the bitcode must not depend on -g (plain $plain bytes, -g $debug bytes)"

# incremental rebuild: the same sources keep the existing file (same bytes and timestamp), a change rewrites it
"$compiler" "$out/fastlib.djinn" --library -o "$out/again.djlib" -O3 "${flags[@]}" > "$out/again.log" 2>&1 || { cat "$out/again.log"; fail "library again must build"; }
cp -p "$out/again.djlib" "$out/again.keep"
sleep 1
"$compiler" "$out/fastlib.djinn" --library -o "$out/again.djlib" -O3 "${flags[@]}" > "$out/again2.log" 2>&1 || { cat "$out/again2.log"; fail "library again must rebuild"; }
cmp -s "$out/again.djlib" "$out/again.keep" || fail "an unchanged library must keep its bytes"
[ ! "$out/again.djlib" -nt "$out/again.keep" ] || fail "an unchanged library must keep its timestamp"
sed 's/ 3 + 1/ 5 + 1/' "$out/fastlib.djinn" > "$out/fastlib2.djinn"
cmp -s "$out/fastlib.djinn" "$out/fastlib2.djinn" && fail "the incremental test needs a different source"
"$compiler" "$out/fastlib2.djinn" --library -o "$out/again.djlib" -O3 "${flags[@]}" > "$out/again3.log" 2>&1 || { cat "$out/again3.log"; fail "library again must rebuild after a change"; }
cmp -s "$out/again.djlib" "$out/again.keep" && fail "a changed library must be rewritten"

# --- supported platforms: `targets:` in djinn.proj, stored in the library and checked by consumers
if [ -n "$exe" ]; then host=windows; other=linux; other_triple=x86_64-unknown-linux-gnu; else host=linux; other=windows; other_triple=x86_64-pc-windows-msvc; fi
tgt="$out/targets"
mkdir -p "$tgt/hostlib/src" "$tgt/otherlib/src" "$tgt/anylib/src" "$tgt/both/src" "$tgt/bad/src"
for name in hostlib otherlib anylib; do
    printf 'namespace %s;

public i32 value() {
    return 7;
}
' "$name" > "$tgt/$name/src/lib.djinn"
done
write_proj() { # <dir> <name> <targets line or empty> <library-mode>
    printf 'project: "%s"

compiler:
  library-mode: %s
%s  output:
    file: "%s.djlib"
    directory: "."
  libs: []
' "$2" "$4" "$3" "$2" > "$1/djinn.proj"
}
write_proj "$tgt/hostlib" hostlib "  targets: [$host]
" true
write_proj "$tgt/otherlib" otherlib "  targets: [$other]
" true
write_proj "$tgt/anylib" anylib "" true
for name in hostlib otherlib anylib; do
    "$compiler" "$tgt/$name" -o "$tgt/$name.djlib" "${flags[@]}" > "$tgt/$name.log" 2>&1 && continue
    # a library for the other platform cannot be built here: the project refuses first
    [ "$name" = otherlib ] && grep -q "the project supports $other; building for $host" "$tgt/$name.log" && continue
    cat "$tgt/$name.log"; fail "library project $name must build"
done
"$compiler" --inspect-lib "$tgt/hostlib.djlib" | grep -q "targets: *$host" || fail "--inspect-lib must list the targets of the library"
"$compiler" --inspect-lib "$tgt/anylib.djlib" | grep -q "targets:" && fail "a library without targets must not list any"
printf 'namespace app;
import hostlib;

i32 main() {
    return hostlib::value() - 7;
}
' > "$tgt/app.djinn"
"$compiler" "$tgt/app.djinn" --lib "$tgt/hostlib.djlib" -o "$tgt/app$exe" "${flags[@]}" > "$tgt/app.log" 2>&1 || { cat "$tgt/app.log"; fail "an app must build against a library for this platform"; }
# a library for another platform: a clear message, not a link error
"$compiler" "$tgt/app.djinn" --lib "$tgt/hostlib.djlib" --target "$other_triple" --emit-ir -o "$tgt/cross" "${flags[@]}" > "$tgt/cross.log" 2>&1 && fail "a library must not be accepted for another platform"
grep -q "supports $host; building for $other" "$tgt/cross.log" || { cat "$tgt/cross.log"; fail "the message must name the platforms the library supports"; }
# the project itself must support the platform being built for
printf 'namespace both;

i32 main() {
    return 0;
}
' > "$tgt/both/src/main.djinn"
write_proj "$tgt/both" both "  targets: [$other]
" false
"$compiler" "$tgt/both" -o "$tgt/both$exe" "${flags[@]}" > "$tgt/both.log" 2>&1 && fail "a project must refuse a platform outside its targets"
grep -q "the project supports $other; building for $host" "$tgt/both.log" || { cat "$tgt/both.log"; fail "the project message must name both platforms"; }
# an app can not claim more platforms than its libraries support
write_proj "$tgt/both" both "  targets: [$host, $other]
  libs: ['hostlib']
" false
"$compiler" "$tgt/both" -o "$tgt/both$exe" --lib-dir "$tgt" "${flags[@]}" > "$tgt/wide.log" 2>&1 && fail "an app must not claim platforms its libraries lack"
grep -q "supports only $host" "$tgt/wide.log" || { cat "$tgt/wide.log"; fail "the message must name the library that narrows the targets"; }
# an unknown word is an error
printf 'namespace bad;

i32 main() {
    return 0;
}
' > "$tgt/bad/src/main.djinn"
write_proj "$tgt/bad" bad "  targets: [plan9]
" false
"$compiler" "$tgt/bad" -o "$tgt/bad$exe" "${flags[@]}" > "$tgt/bad.log" 2>&1 && fail "an unknown platform word must be an error"
grep -q "unknown platform 'plan9'" "$tgt/bad.log" || { cat "$tgt/bad.log"; fail "the message must name the unknown word"; }

echo "library: ok"
