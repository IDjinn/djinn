#!/usr/bin/env bash
set -eu
compiler="${1:?usage: jit_libs.sh <djinnc> <runtime lib> [runtime dir]}"
runtime_lib="${2:?usage: jit_libs.sh <djinnc> <runtime lib> [runtime dir]}"
runtime="${3:-runtime}"
root="$(cd "$(dirname "$0")/../.." && pwd)"
out="$root/build/unit/jit_libs"
std_libs="$root/build/unit/libs"
rm -rf "$out"
mkdir -p "$out/lib/src" "$out/app/src" "$out/native" "$out/proj/src" "$out/libs"
cd "$root"

fail() { echo "FAIL jit_libs: $1"; exit 1; }

flags=(--lib-dir "$out/libs" --std-dir "$root/std" --runtime-dir "$runtime" --runtime-lib "$runtime_lib")
if [ -n "${DJINN_USE_LLD:-}" ]; then
    flags+=(--lld)
fi
cp "$std_libs"/std.djlib* "$out/libs/" 2>/dev/null || fail "build std.djlib first (tests/djinnc/unit.sh does)"

# A generic function of a library is compiled with the app and writes a global that lives in the library.
printf 'project: "statelib"\nversion: "0.1.0"\n\ncompiler:\n  library-mode: true\n  libs: [\x27std\x27]\n' > "$out/lib/djinn.proj"
cat > "$out/lib/src/state.djinn" <<'EOF'
namespace statelib;
unsafe static mut u64 saved = 0;
struct Cell {
    public static unsafe void put<T>(T* value) {
        saved = (u64)(ptr)value;
    }
    public static unsafe u64 get() { return saved; }
}
EOF
"$compiler" "$out/lib" -o "$out/libs/statelib.djlib" "${flags[@]}" > "$out/lib.log" 2>&1 || { cat "$out/lib.log"; fail "the library must build"; }
printf 'project: "stateapp"\nversion: "0.1.0"\n\ncompiler:\n  library-mode: false\n  libs: [\x27std\x27, \x27statelib\x27]\n' > "$out/app/djinn.proj"
cat > "$out/app/src/main.djinn" <<'EOF'
import statelib;
unsafe i32 main() {
    mut i64 value = 0;
    Cell.put<i64>(&value);
    if (Cell.get() != (u64)(ptr)&value) {
        return 2;
    }
    return 0;
}
EOF
"$compiler" "$out/app" -o "$out/stateapp" --run "${flags[@]}" > "$out/state.log" 2>&1 && status=0 || status=$?
[ "$status" = 0 ] || { cat "$out/state.log"; fail "--run must share the globals of a library with the app, got $status"; }

cc="${CC:-clang}"
if ! command -v "$cc" > /dev/null 2>&1; then
    echo "PASS jit_libs (native libraries skipped: no C compiler '$cc')"
    exit 0
fi
native="build/unit/jit_libs/native"
case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*) shared="$native/jitshared.dll"; archive="$native/jitstatic.lib"; pic="" ;;
    Darwin*) shared="$native/libjitshared.dylib"; archive="$native/libjitstatic.a"; pic="-fPIC" ;;
    *) shared="$native/libjitshared.so"; archive="$native/libjitstatic.a"; pic="-fPIC" ;;
esac
ar_tool=ar
command -v llvm-ar > /dev/null 2>&1 && ar_tool=llvm-ar

cat > "$native/shared.c" <<'EOF'
#ifdef _WIN32
__declspec(dllexport)
#endif
int djinn_shared_value(void) { return 40; }
EOF
echo 'int djinn_static_value(void) { return 2; }' > "$native/static.c"
"$cc" -shared $pic "$native/shared.c" -o "$shared" > "$out/cc.log" 2>&1 || { cat "$out/cc.log"; fail "the C shared library must build"; }
"$cc" -c $pic "$native/static.c" -o "$native/static.o" > "$out/cc.log" 2>&1 || { cat "$out/cc.log"; fail "the C object must build"; }
"$ar_tool" rcs "$archive" "$native/static.o" > "$out/ar.log" 2>&1 || { cat "$out/ar.log"; fail "the C static library must build"; }

cat > "$out/proj/src/main.djinn" <<'EOF'
extern "C" {
    i32 djinn_shared_value();
    i32 djinn_static_value();
}
i32 main() {
    return djinn_shared_value() + djinn_static_value();
}
EOF

# -l and -L of the command line: a shared and a static library.
"$compiler" "$out/proj/src/main.djinn" -o "$out/cli" --run "-L$native" -ljitshared -ljitstatic "${flags[@]}" > "$out/cli.log" 2>&1 && status=0 || status=$?
[ "$status" = 42 ] || { cat "$out/cli.log"; fail "--run must load the -l libraries, got $status"; }

# The same from djinn.proj.
printf 'project: "nativeapp"\nversion: "0.1.0"\n\ncompiler:\n  library-mode: false\n  libs: [\x27std\x27]\n\n  \x27-L%s\x27\n  \x27-ljitshared\x27\n  \x27-ljitstatic\x27\n' "$native" > "$out/proj/djinn.proj"
"$compiler" "$out/proj" -o "$out/nativeapp" --run "${flags[@]}" > "$out/proj.log" 2>&1 && status=0 || status=$?
[ "$status" = 42 ] || { cat "$out/proj.log"; fail "--run must load the libraries of djinn.proj, got $status"; }

# A library that cannot be loaded is named when a symbol is missing.
"$compiler" "$out/proj/src/main.djinn" -o "$out/absent" --run "-L$native" -ljitshared -ljit_absent "${flags[@]}" > "$out/absent.log" 2>&1 && status=0 || status=$?
[ "$status" = 1 ] || { cat "$out/absent.log"; fail "a missing library must exit with 1, got $status"; }
grep -q "could not load the library '-ljit_absent'" "$out/absent.log" || { cat "$out/absent.log"; fail "the missing library must be named"; }

echo "PASS jit_libs"
