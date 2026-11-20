#!/usr/bin/env bash
# Packs a NativeActivity app into a signed APK without Gradle: aapt2 (manifest), zip (the library), zipalign, apksigner.
# usage: android_apk.sh --lib <libname.so> --abi <arm64-v8a|x86_64> --out <app.apk> [--package <id>] [--label <name>] [--min-api 26] [--debuggable]
# environment: ANDROID_HOME (the SDK), JAVA_HOME or keytool on PATH (a debug keystore is created once in ~/.android).
set -eu

package="dev.djinn.app"
label="Djinn app"
min_api=26
debuggable=false
lib="" abi="" out=""
while [ $# -gt 0 ]; do
    case "$1" in
        --lib) lib="$2"; shift 2 ;;
        --abi) abi="$2"; shift 2 ;;
        --out) out="$2"; shift 2 ;;
        --package) package="$2"; shift 2 ;;
        --label) label="$2"; shift 2 ;;
        --min-api) min_api="$2"; shift 2 ;;
        --debuggable) debuggable=true; shift ;;
        *) echo "android_apk: unknown argument $1"; exit 2 ;;
    esac
done
if [ -z "$lib" ] || [ -z "$abi" ] || [ -z "$out" ]; then
    echo "usage: android_apk.sh --lib <lib.so> --abi <abi> --out <app.apk> [--package id] [--label name] [--min-api n]"
    exit 2
fi

sdk="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
if [ -z "$sdk" ] && [ -n "${LOCALAPPDATA:-}" ]; then sdk="$(cygpath -u "$LOCALAPPDATA")/Android/Sdk"; fi
[ -d "$sdk" ] || { echo "android_apk: set ANDROID_HOME"; exit 1; }
build_tools="$(ls -d "$sdk"/build-tools/*/ | sort | tail -1)"
build_tools="${build_tools%/}"
platform="$(ls -d "$sdk"/platforms/android-*/ | sort -V | tail -1)"
platform="${platform%/}"
exe=""
case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) exe=".exe" ;; esac
bat=""
case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) bat=".bat" ;; esac

name="$(basename "$lib" .so)"
name="${name#lib}"
work="$(dirname "$out")/apk-work-$name"
rm -rf "$work"
mkdir -p "$work/lib/$abi"
cp "$lib" "$work/lib/$abi/lib$name.so"

cat > "$work/AndroidManifest.xml" <<MANIFEST
<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="$package">
    <uses-sdk android:minSdkVersion="$min_api" android:targetSdkVersion="34"/>
    <application android:label="$label" android:hasCode="true" android:debuggable="$debuggable">
        <activity android:name="dev.djinn.DjinnActivity" android:exported="true"
            android:configChanges="orientation|keyboardHidden|screenSize|screenLayout|density|uiMode|smallestScreenSize"
            android:launchMode="singleTask">
            <meta-data android:name="android.app.lib_name" android:value="$name"/>
            <intent-filter>
                <action android:name="android.intent.action.MAIN"/>
                <category android:name="android.intent.category.LAUNCHER"/>
            </intent-filter>
        </activity>
    </application>
</manifest>
MANIFEST

# DjinnActivity (runtime/android/java): a NativeActivity with the text-editor view the soft keyboard needs and the window insets.
# Compiled here with the JDK's javac and the SDK's d8, so an app never needs Gradle.
java_src="$(cd "$(dirname "$0")/.." && pwd)/runtime/android/java"
mkdir -p "$work/java-classes" "$work/dex"
javac --release 11 -classpath "$platform/android.jar" -d "$work/java-classes" "$java_src/dev/djinn/DjinnActivity.java" 2>&1 | grep -v "^warning\|^Note" || true
(cd "$work/java-classes" && find . -name '*.class' | sed 's#^\./##') > "$work/classes.list"
[ -s "$work/classes.list" ] || { echo "android_apk: javac failed (needs a JDK)"; exit 1; }
(cd "$work/java-classes" && "$build_tools/d8$bat" --lib "$platform/android.jar" --min-api "$min_api" --output "$work/dex" $(cat "$work/classes.list")) 2>&1 | grep -v "^WARNING" || true
[ -f "$work/dex/classes.dex" ] || { echo "android_apk: d8 failed"; exit 1; }

# the manifest and resources go through aapt2; the library is added afterwards (stored, aligned, so it can be mapped)
"$build_tools/aapt2$exe" link -o "$work/base.apk" -I "$platform/android.jar" --manifest "$work/AndroidManifest.xml" \
    --min-sdk-version "$min_api" --target-sdk-version 34
# stored (uncompressed), so the system can map the library straight from the APK
python_tool=""
for candidate in python3 python py; do
    if command -v "$candidate" > /dev/null 2>&1 && "$candidate" -c "import zipfile" > /dev/null 2>&1; then python_tool="$candidate"; break; fi
done
[ -n "$python_tool" ] || { echo "android_apk: needs python to add the library to the APK"; exit 1; }
"$python_tool" - "$work/base.apk" "$work/unaligned.apk" "$work/lib/$abi/lib$name.so" "lib/$abi/lib$name.so" "$work/dex/classes.dex" <<'PY'
import sys, zipfile
base, out, path, entry, dex = sys.argv[1:6]
with zipfile.ZipFile(base) as source, zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as target:
    for item in source.infolist():
        target.writestr(item, source.read(item.filename))
    target.write(path, entry, compress_type=zipfile.ZIP_STORED)
    target.write(dex, "classes.dex", compress_type=zipfile.ZIP_DEFLATED)
PY
"$build_tools/zipalign$exe" -f -p 4 "$work/unaligned.apk" "$work/aligned.apk"

keystore="$HOME/.android/debug.keystore"
if [ ! -f "$keystore" ]; then
    mkdir -p "$HOME/.android"
    keytool -genkeypair -keystore "$keystore" -storepass android -keypass android -alias androiddebugkey \
        -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Android Debug,O=Android,C=US"
fi
"$build_tools/apksigner$bat" sign --ks "$keystore" --ks-pass pass:android --key-pass pass:android --out "$out" "$work/aligned.apk"
rm -rf "$work"
echo "$out"
