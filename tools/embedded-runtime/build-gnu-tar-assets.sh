#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MODULE_ROOT="$ROOT/modules/agent-workspace-runtime/android/src/main"
API=26

TAR_VERSION=1.35
TAR_SHA256=4d62ff37342ec7aed748535323930c7cf94acf71c3591882b26a7ea50f3edc16
TERMUX_PACKAGES_COMMIT=fea50ba4649e6fddd1861741402c0aafa63411f2
GLOB_C_SHA256=d9c04df55f97bdc5335c3b76224b47a2b20ccef27c73103208f8074320aba014
GLOB_H_SHA256=ff4512c530aea288693f5be17e98c77faf7f449ea439df46164ad34aab197122

NDK="${UDROID_TAR_NDK_HOME:-${ANDROID_HOME:-$HOME/Android/Sdk}/ndk/26.1.10909125}"

case "$(uname -s)-$(uname -m)" in
  Linux-x86_64) HOST_TAG=linux-x86_64 ;;
  Darwin-x86_64) HOST_TAG=darwin-x86_64 ;;
  Darwin-arm64) HOST_TAG=darwin-x86_64 ;;
  *) echo "Unsupported build host: $(uname -s)-$(uname -m)" >&2; exit 2 ;;
esac

TOOLCHAIN="$NDK/toolchains/llvm/prebuilt/$HOST_TAG/bin"
if [[ ! -x "$TOOLCHAIN/llvm-ar" ]]; then
  echo "Android NDK 26.1.10909125 not found at $NDK" >&2
  exit 1
fi

WORK="$(mktemp -d "${TMPDIR:-/tmp}/agentui-gnu-tar-build.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'
  else shasum -a 256 "$1" | awk '{print $1}'
  fi
}

fetch_checked() {
  local url="$1" output="$2" expected="$3"
  curl --fail --location --silent --show-error "$url" --output "$output"
  local actual
  actual="$(sha256_file "$output")"
  [[ "$actual" == "$expected" ]] || {
    echo "Checksum mismatch for $url" >&2
    echo "expected $expected" >&2
    echo "actual   $actual" >&2
    exit 1
  }
}

fetch_checked "https://mirrors.kernel.org/gnu/tar/tar-${TAR_VERSION}.tar.xz" "$WORK/tar.tar.xz" "$TAR_SHA256"
fetch_checked "https://raw.githubusercontent.com/termux/termux-packages/${TERMUX_PACKAGES_COMMIT}/packages/libandroid-glob/glob.c" "$WORK/glob.c" "$GLOB_C_SHA256"
fetch_checked "https://raw.githubusercontent.com/termux/termux-packages/${TERMUX_PACKAGES_COMMIT}/packages/libandroid-glob/glob.h" "$WORK/glob.h" "$GLOB_H_SHA256"

build_abi() {
  local abi="$1" compiler_triple="$2" host_triple="$3"
  local cc="$TOOLCHAIN/${compiler_triple}${API}-clang"
  local ar="$TOOLCHAIN/llvm-ar"
  local ranlib="$TOOLCHAIN/llvm-ranlib"
  local strip="$TOOLCHAIN/llvm-strip"
  local abi_work="$WORK/$abi"
  local source="$abi_work/source"
  local build="$abi_work/build"
  local deps="$abi_work/deps"

  mkdir -p "$source" "$build" "$deps/include" "$deps/lib"
  tar -xJf "$WORK/tar.tar.xz" -C "$source" --strip-components=1
  install -m 644 "$WORK/glob.h" "$deps/include/glob.h"
  "$cc" -O2 -I"$deps/include" -c "$WORK/glob.c" -o "$deps/lib/glob.o"
  "$ar" rcs "$deps/lib/libandroid-glob.a" "$deps/lib/glob.o"

  (
    cd "$build"
    env       CC="$cc" AR="$ar" RANLIB="$ranlib" STRIP="$strip"       CPPFLAGS="-I$deps/include" CFLAGS="-O2" LDFLAGS="-L$deps/lib" LIBS="-landroid-glob"       gl_cv_struct_dirent_d_ino=yes ac_cv_func_mkfifoat=yes       "$source/configure"         --host="$host_triple"         --prefix="/data/local/tmp/agentui-gnu-tar-${TAR_VERSION}"         --disable-nls --without-selinux --without-posix-acls --disable-acl --disable-year2038
    make -j"${AGENTUI_BUILD_JOBS:-2}"
  )

  local asset_dir="$MODULE_ROOT/assets/runtime/$abi"
  mkdir -p "$asset_dir"
  "$strip" "$build/src/tar" -o "$asset_dir/tar"
  chmod 755 "$asset_dir/tar"
  echo "$abi tar: $(sha256_file "$asset_dir/tar")"
}

if [[ "$#" -eq 0 ]]; then set -- arm64-v8a; fi

for abi in "$@"; do
  case "$abi" in
    arm64-v8a) build_abi "$abi" aarch64-linux-android aarch64-linux-android ;;
    armeabi-v7a) build_abi "$abi" armv7a-linux-androideabi arm-linux-androideabi ;;
    x86_64) build_abi "$abi" x86_64-linux-android x86_64-linux-android ;;
    *) echo "Unsupported ABI: $abi" >&2; exit 2 ;;
  esac
done
