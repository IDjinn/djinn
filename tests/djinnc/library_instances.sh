#!/usr/bin/env bash
set -eu
compiler="${1:?usage: library_instances.sh <djinnc> <runtime lib> [runtime dir]}"
runtime_lib="${2:?usage: library_instances.sh <djinnc> <runtime lib> [runtime dir]}"
runtime="${3:-runtime}"
root="$(cd "$(dirname "$0")/../.." && pwd)"
out="$root/build/unit/library_instances"
std_libs="$root/build/unit/libs"
rm -rf "$out"
mkdir -p "$out"
cd "$root"

fail() { echo "FAIL library_instances: $1"; exit 1; }

flags=(--verbose --std-dir "$root/std" --runtime-dir "$runtime" --runtime-lib "$runtime_lib")
if [ -n "${DJINN_USE_LLD:-}" ]; then
    flags+=(--lld)
fi
exe=""
case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) exe=".exe" ;; esac

project() {
    mkdir -p "$out/$1/src"
    printf 'project: "%s"\nversion: "0.1.0"\n\ncompiler:\n  library-mode: %s\n  libs: [%s]\n' "$1" "$2" "$3" > "$out/$1/djinn.proj"
}

project alib true "'std'"
cat > "$out/alib/src/alib.djinn" <<'EOF'
namespace alib;

constexpr arr<i32> TABLE = [3, 2, 3, 4];

struct Point {
    i32 x;
    i32 y;
}

constexpr Point ORIGIN = { .x = 5, .y = 6 };

unsafe static mut u64 state = 0;

struct Cell {
    public static unsafe void put<T>(T* value) { state = (u64)(ptr)value; }
    public static unsafe u64 get() { return state; }
}

struct Pick {
    public static T first<T>(T left, T right) { return left; }
}

struct Box<T> {
    T item;
    public T take() { return this.item; }
}

public T twice<T>(T value) { return value + value; }

private i32 secret() { return 11; }

public i32 reveal<T>(T ignored) { return secret(); }

public i32 lookup<T>(T index) { return TABLE[(i32)index] + ORIGIN.x; }
EOF

# Every public function is small enough to be inlined into the app from the library bitcode at O2.
project blib true "'std', 'alib'"
cat > "$out/blib/src/blib.djinn" <<'EOF'
namespace blib;

import alib;
import std::collections;

public T own<T>(T value) { return value; }

public i32 static_method(i32 value) { return Pick.first<i32>(value, 0); }

public i32 generic_function(i32 value) { return twice<i32>(value); }

public i32 own_generic(i32 value) { return own<i32>(value); }

public i32 generic_struct(i32 value) {
    Box<i32> box = { .item = value };
    return box.take();
}

public i32 std_instance(u16 value) {
    mut array<u16> items = {};
    items.push(value);
    return (i32)items.get(0);
}

public i32 private_call() { return reveal<i32>(0); }

public i32 constants(i32 index) { return TABLE[index] + ORIGIN.y + lookup<i32>(index); }

public unsafe i32 foreign_global() {
    mut i32 value = 0;
    Cell.put<i32>(&value);
    if (Cell.get() != (u64)(ptr)&value) { return 3; }
    return 0;
}

public unsafe i32 direct_global(u64 value) {
    state = value;
    if (state != value) { return 4; }
    if (Cell.get() != value) { return 5; }
    return 0;
}

public unsafe u64* state_address() { return &state; }

public string formatted(f64 value) { return $"{value}"; }

public unsafe i32 c_length(string text) {
    i8* raw = Reflection.terminated(text);
    return (i32)strlen(raw);
}
EOF

project app false "'std', 'alib', 'blib'"
cat > "$out/app/src/main.djinn" <<'EOF'
import blib;

i32 main() {
    if (static_method(7) != 7) { return 11; }
    if (generic_function(21) != 42) { return 12; }
    if (own_generic(9) != 9) { return 13; }
    if (generic_struct(5) != 5) { return 14; }
    if (std_instance((u16)2) != 2) { return 15; }
    if (private_call() != 11) { return 16; }
    if (constants(0) != 17) { return 17; }
    unsafe {
        if (c_length(formatted(1.5)) != 3) { return 18; }
    }
    return 0;
}
EOF

project state_app false "'std', 'alib', 'blib'"
cat > "$out/state_app/src/main.djinn" <<'EOF'
import alib;
import blib;

unsafe i32 main() {
    mut i64 value = 0;
    Cell.put<i64>(&value);
    if (Cell.get() != (u64)(ptr)&value) { return 2; }
    i32 foreign = foreign_global();
    if (foreign != 0) { return foreign; }
    i32 direct = direct_global((u64)41);
    if (direct != 0) { return direct; }
    if (state != (u64)41) { return 6; }
    if (state_address() != &state) { return 7; }
    return 0;
}
EOF

# An optimized app internalizes what it defines, so it must keep the core that the library objects (std included) call.
for levels in "-O0 -O0" "-O2 -O2" "-O0 -O2"; do
    read -r lib_level app_level <<< "$levels"
    libs="$out/libs$lib_level"
    if [ ! -f "$libs/blib.djlib" ]; then
        mkdir -p "$libs"
        if [ "$lib_level" = -O0 ]; then
            cp "$std_libs"/std.djlib* "$libs/" 2>/dev/null || fail "build std.djlib first (tests/djinnc/unit.sh does)"
        else
            bash tools/build_std.sh "$compiler" "$libs/std.djlib" --runtime-dir "$runtime" --runtime-lib "$runtime_lib" \
                ${DJINN_USE_LLD:+--lld} --verbose "$lib_level" > "$out/std$lib_level.log" 2>&1 \
                || { cat "$out/std$lib_level.log"; fail "std must build at $lib_level"; }
        fi
        for name in alib blib; do
            "$compiler" "$out/$name" -o "$libs/$name.djlib" --lib-dir "$libs" "${flags[@]}" "$lib_level" > "$out/$name$lib_level.log" 2>&1 \
                || { cat "$out/$name$lib_level.log"; fail "$name must build at $lib_level"; }
        done
    fi
    for name in app state_app; do
        built="$name$lib_level$app_level"
        "$compiler" "$out/$name" -o "$out/$built$exe" --lib-dir "$libs" "${flags[@]}" "$app_level" > "$out/$built.log" 2>&1 \
            || { cat "$out/$built.log"; fail "$name must link at $app_level against libraries at $lib_level"; }
        "$out/$built$exe" || fail "$built exited with $?"
        "$compiler" "$out/$name" --run --lib-dir "$libs" "${flags[@]}" "$app_level" > "$out/$built.run.log" 2>&1 \
            || { cat "$out/$built.run.log"; fail "$built must pass under --run"; }
    done
done

# A procedural macro runs in a JIT too, from the objects of the libraries.
project mlib true "'std', 'alib'"
cat > "$out/mlib/src/mlib.djinn" <<'EOF'
namespace mlib;

import alib;
import std::meta;

TokenStream expand_stored(TokenStream input) {
    mut TokenStream out = TokenStream.create();
    unsafe {
        state = (u64)7;
        if (state == (u64)7) {
            out.push(Token.number("7"));
        } else {
            out.push(Token.number("1"));
        }
    }
    return out;
}

proc macro stored => expand_stored;
EOF

project macro_app false "'std', 'alib', 'mlib'"
cat > "$out/macro_app/src/main.djinn" <<'EOF'
import mlib;

i32 main() {
    return stored!() - 7;
}
EOF

libs="$out/libs-O0"
"$compiler" "$out/mlib" -o "$libs/mlib.djlib" --lib-dir "$libs" "${flags[@]}" > "$out/mlib.log" 2>&1 \
    || { cat "$out/mlib.log"; fail "mlib must build"; }
"$compiler" "$out/macro_app" -o "$out/macro_app_bin$exe" --lib-dir "$libs" "${flags[@]}" > "$out/macro_app.log" 2>&1 \
    || { cat "$out/macro_app.log"; fail "a procedural macro must write a global of another library"; }
"$out/macro_app_bin$exe" || fail "macro_app exited with $?"

echo "PASS library_instances"
