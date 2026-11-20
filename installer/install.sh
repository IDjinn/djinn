#!/usr/bin/env sh
# Djinn installer and updater for Linux and macOS.
#
#   curl -fsSL https://github.com/IDjinn/djinn-lang-v3/releases/latest/download/install.sh | sh
#   sh install.sh [install] [options]
#   djinn-setup update [--quiet]      (also: extension, uninstall)
#
# Options:
#   --prefix <dir>        install location (default: $DJINN_HOME or ~/.djinn)
#   --version <tag>       install a specific release tag (default: latest)
#   --extension           also install the VS Code extension
#   --no-extension        do not install the VS Code extension
#   --ui                  also install the UI framework libraries (ui, ui_macros and the platform host)
#   --vulkan              also install the Vulkan renderer (vulkan, spirv); implies --ui
#   --android             also install the Android target libraries and build tools (needs the Android SDK and NDK to use)
#   --no-auto-update      do not register the cron job
#   --no-path             do not touch shell profiles
#   --quiet               print errors only
#   -y, --yes             never ask questions (extension defaults to yes when VS Code is found)
#
# Layout:  <prefix>/versions/<tag>/{bin,lib,runtime,std}   <prefix>/current -> versions/<tag>
#          <prefix>/bin/djinn-setup (this script, called by cron)
set -eu

REPO="${DJINN_REPO:-IDjinn/djinn-lang-v3}"
HOME_DIR="${DJINN_HOME:-$HOME/.djinn}"
MODE="install"
TAG=""
EXTENSION="ask"
UI=ask
VULKAN=ask
ANDROID=ask
CRON=1
PATH_SETUP=1
QUIET=0
YES=0

case "${1:-}" in
    install|update|uninstall|extension) MODE="$1"; shift ;;
esac
while [ $# -gt 0 ]; do
    case "$1" in
        --prefix) HOME_DIR="$2"; shift 2 ;;
        --version) TAG="$2"; shift 2 ;;
        --extension) EXTENSION=yes; shift ;;
        --no-extension) EXTENSION=no; shift ;;
        --ui) UI=yes; shift ;;
        --vulkan) UI=yes; VULKAN=yes; shift ;;
        --android) ANDROID=yes; shift ;;
        --no-auto-update) CRON=0; shift ;;
        --no-path) PATH_SETUP=0; shift ;;
        --quiet) QUIET=1; shift ;;
        -y|--yes) YES=1; shift ;;
        -h|--help) sed -n '2,22p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) echo "djinn-setup: unknown option $1" >&2; exit 2 ;;
    esac
done

say() { [ "$QUIET" = 1 ] || printf '%s\n' "$*"; }
die() { printf 'djinn-setup: %s\n' "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

fetch() { # fetch <url> <file>
    if have curl; then curl -fsSL "$1" -o "$2"; elif have wget; then wget -q "$1" -O "$2"; else die "curl or wget is required"; fi
}
fetch_text() {
    if have curl; then curl -fsSL "$1"; elif have wget; then wget -qO- "$1"; else die "curl or wget is required"; fi
}

detect_platform() {
    os="$(uname -s)"; arch="$(uname -m)"
    case "$os" in Linux) os=linux ;; Darwin) os=macos ;; *) die "unsupported system $os (Windows: use install.ps1)" ;; esac
    case "$arch" in x86_64|amd64) arch=x86_64 ;; aarch64|arm64) arch=aarch64 ;; *) die "unsupported architecture $arch" ;; esac
    echo "$os-$arch"
}

latest_tag() {
    fetch_text "https://api.github.com/repos/$REPO/releases/latest" | sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1
}

current_tag() {
    if [ -L "$HOME_DIR/current" ]; then basename "$(readlink "$HOME_DIR/current")"; fi
}

verify_sha() { # verify_sha <file> <sha256 file>
    expected="$(cut -d ' ' -f 1 "$2")"
    if have sha256sum; then actual="$(sha256sum "$1" | cut -d ' ' -f 1)"
    elif have shasum; then actual="$(shasum -a 256 "$1" | cut -d ' ' -f 1)"
    else say "warning: no sha256 tool, skipping checksum"; return 0; fi
    [ "$expected" = "$actual" ] || die "checksum mismatch for $(basename "$1")"
}

code_cli() {
    for candidate in code code-insiders codium; do
        if have "$candidate"; then echo "$candidate"; return 0; fi
    done
    if [ -x "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" ]; then
        echo "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code"; return 0
    fi
    return 1
}

ask_extension() {
    if [ "$EXTENSION" != ask ]; then return; fi
    cli="$(code_cli || true)"
    if [ -z "$cli" ]; then EXTENSION=no; return; fi
    if [ "$YES" = 1 ] || ! ( : < /dev/tty ) 2>/dev/null; then EXTENSION=yes; return; fi
    printf '[x] Install the Djinn VS Code extension (language server, highlighting, build and debug)? [Y/n] ' > /dev/tty
    read -r answer < /dev/tty || answer=""
    case "$answer" in n|N|no|NO) EXTENSION=no ;; *) EXTENSION=yes ;; esac
}

# Optional components are staged in the release under optional/<name>/ with the layout of the install. The picks are
# kept in <prefix>/.components so an update installs the same ones.
ask_yes() { # <question>: yes only when asked on a terminal and answered y; --yes and no terminal mean no
    if [ "$YES" = 1 ] || ! ( : < /dev/tty ) 2>/dev/null; then return 1; fi
    printf '[ ] %s [y/N] ' "$1" > /dev/tty
    read -r answer < /dev/tty || answer=""
    case "$answer" in y|Y|yes|YES) return 0 ;; *) return 1 ;; esac
}

choose_components() {
    saved="$HOME_DIR/.components"
    if [ "$UI" = ask ]; then
        if [ -f "$saved" ] && grep -qx ui "$saved"; then UI=yes
        elif [ "$MODE" = install ] && ask_yes "Install the UI framework libraries (ui, ui_macros, platform host)?"; then UI=yes
        else UI=no; fi
    fi
    if [ "$VULKAN" = ask ]; then
        if [ "$UI" != yes ]; then VULKAN=no
        elif [ -f "$saved" ] && grep -qx vulkan "$saved"; then VULKAN=yes
        elif [ "$MODE" = install ] && ask_yes "Install the Vulkan renderer for the UI (GPU drawing)?"; then VULKAN=yes
        else VULKAN=no; fi
    fi
    if [ "$ANDROID" = ask ]; then
        if [ -f "$saved" ] && grep -qx android "$saved"; then ANDROID=yes
        elif [ "$MODE" = install ] && ask_yes "Install the Android target (libraries and build tools; needs the Android SDK and NDK)?"; then ANDROID=yes
        else ANDROID=no; fi
    fi
}

install_components() { # <version dir>
    staged="$1/optional"
    : > "$HOME_DIR/.components"
    for part in ui vulkan android; do
        want=no
        [ "$part" = ui ] && want="$UI"
        [ "$part" = vulkan ] && want="$VULKAN"
        [ "$part" = android ] && want="$ANDROID"
        [ "$want" = yes ] || continue
        if [ -d "$staged/$part" ]; then
            cp -R "$staged/$part/." "$1/"
            echo "$part" >> "$HOME_DIR/.components"
        else
            say "warning: this release has no '$part' component"
        fi
    done
    rm -rf "$staged"
}

install_extension() { # <tag> <tmp>
    cli="$(code_cli || true)"
    if [ -z "$cli" ]; then say "VS Code was not found; install the extension later with: djinn-setup extension"; return; fi
    fetch "https://github.com/$REPO/releases/download/$1/djinn-lang.vsix" "$2/djinn-lang.vsix" || { say "warning: this release has no extension package"; return; }
    "$cli" --install-extension "$2/djinn-lang.vsix" --force >/dev/null 2>&1 && say "VS Code extension installed" || say "warning: could not install the extension"
    : > "$HOME_DIR/.extension"
}

register_cron() {
    have crontab || { say "warning: crontab not found, auto update disabled"; return; }
    entry="17 */6 * * * \"$HOME_DIR/bin/djinn-setup\" update --quiet >> \"$HOME_DIR/update.log\" 2>&1 # djinn-auto-update"
    ( crontab -l 2>/dev/null | grep -v 'djinn-auto-update' || true; echo "$entry" ) | crontab -
    say "auto update scheduled with cron (every 6 hours)"
}

unregister_cron() {
    have crontab || return 0
    ( crontab -l 2>/dev/null | grep -v 'djinn-auto-update' || true ) | crontab - 2>/dev/null || true
}

setup_path() {
    line="export PATH=\"$HOME_DIR/current/bin:$HOME_DIR/bin:\$PATH\" # djinn"
    for profile in "$HOME/.profile" "$HOME/.bashrc" "$HOME/.zshrc"; do
        [ -f "$profile" ] || [ "$profile" = "$HOME/.profile" ] || continue
        if ! grep -qs '# djinn$' "$profile" 2>/dev/null; then
            printf '\n%s\n' "$line" >> "$profile"
        fi
    done
    say "added $HOME_DIR/current/bin to PATH (open a new shell)"
}

do_install() {
    platform="$(detect_platform)"
    [ -n "$TAG" ] || TAG="$(latest_tag)"
    [ -n "$TAG" ] || die "could not find the latest release of $REPO"
    installed="$(current_tag || true)"
    if [ "$MODE" = update ] && [ "$installed" = "$TAG" ]; then
        say "Djinn $TAG is up to date"
        return 0
    fi
    [ "$MODE" = update ] && [ -z "$installed" ] && die "Djinn is not installed in $HOME_DIR"

    name="djinn-$TAG-$platform"
    tmp="$(mktemp -d)"
    trap 'rm -rf "$tmp"' EXIT
    say "Downloading Djinn $TAG ($platform)"
    fetch "https://github.com/$REPO/releases/download/$TAG/$name.tar.gz" "$tmp/$name.tar.gz" || die "no build of $TAG for $platform"
    fetch "https://github.com/$REPO/releases/download/$TAG/$name.tar.gz.sha256" "$tmp/$name.sha256" && verify_sha "$tmp/$name.tar.gz" "$tmp/$name.sha256"

    mkdir -p "$HOME_DIR/versions" "$HOME_DIR/bin"
    rm -rf "$HOME_DIR/versions/$TAG.partial"
    mkdir -p "$HOME_DIR/versions/$TAG.partial"
    tar -C "$HOME_DIR/versions/$TAG.partial" -xzf "$tmp/$name.tar.gz"
    rm -rf "$HOME_DIR/versions/$TAG"
    mv "$HOME_DIR/versions/$TAG.partial/$name" "$HOME_DIR/versions/$TAG"
    rmdir "$HOME_DIR/versions/$TAG.partial"
    choose_components
    install_components "$HOME_DIR/versions/$TAG"

    ln -sfn "versions/$TAG" "$HOME_DIR/current.new"
    mv -fT "$HOME_DIR/current.new" "$HOME_DIR/current" 2>/dev/null || { rm -f "$HOME_DIR/current"; mv "$HOME_DIR/current.new" "$HOME_DIR/current"; }

    # keep a stable copy of this script for cron and manual updates
    if [ -f "$0" ] && [ "$(basename "$0")" != "sh" ]; then cp "$0" "$HOME_DIR/bin/djinn-setup"; else fetch "https://github.com/$REPO/releases/download/$TAG/install.sh" "$HOME_DIR/bin/djinn-setup" || true; fi
    chmod +x "$HOME_DIR/bin/djinn-setup" 2>/dev/null || true

    # keep the two newest versions
    ls -1t "$HOME_DIR/versions" 2>/dev/null | grep -v '\.partial$' | tail -n +3 | while read -r old; do
        [ "$old" = "$TAG" ] || rm -rf "$HOME_DIR/versions/$old"
    done

    if [ "$MODE" = install ]; then
        ask_extension
        [ "$PATH_SETUP" = 1 ] && setup_path
        [ "$CRON" = 1 ] && register_cron
    fi
    if [ "$EXTENSION" = yes ] || { [ "$MODE" = update ] && [ -f "$HOME_DIR/.extension" ]; }; then
        install_extension "$TAG" "$tmp"
    fi
    say "Djinn $TAG installed in $HOME_DIR/versions/$TAG (restart VS Code to pick it up)"
}

case "$MODE" in
    install|update) do_install ;;
    extension)
        tag="$(current_tag || true)"
        [ -n "$tag" ] || die "Djinn is not installed in $HOME_DIR"
        tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
        install_extension "$tag" "$tmp"
        ;;
    uninstall)
        unregister_cron
        rm -rf "$HOME_DIR"
        say "Djinn removed (shell profile lines marked '# djinn' can be deleted by hand)"
        ;;
esac
