#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MODULE_ROOT="$ROOT/modules/agent-workspace-runtime/android/src/main"
API=26

PROOT_VERSION=5.1.107.86
PROOT_SHA256=692da7f952ac390eb65c4117d360cad23a052525eea4eb110ae42f8a4a7d7bb8
TALLOC_VERSION=2.4.3
TALLOC_SHA256=dc46c40b9f46bb34dd97fe41f548b0e8b247b77a918576733c528e83abd854dd

NDK="${ANDROID_NDK_HOME:-${ANDROID_HOME:-$HOME/Android/Sdk}/ndk/28.2.13676358}"

case "$(uname -s)-$(uname -m)" in
  Linux-x86_64) HOST_TAG=linux-x86_64 ;;
  Darwin-x86_64) HOST_TAG=darwin-x86_64 ;;
  Darwin-arm64) HOST_TAG=darwin-x86_64 ;;
  *) echo "Unsupported build host: $(uname -s)-$(uname -m)" >&2; exit 2 ;;
esac

TOOLCHAIN="$NDK/toolchains/llvm/prebuilt/$HOST_TAG/bin"
if [[ ! -x "$TOOLCHAIN/llvm-ar" ]]; then
  echo "Android NDK 28.2.13676358 not found at $NDK" >&2
  exit 1
fi

WORK="$(mktemp -d "${TMPDIR:-/tmp}/agentui-proot-build.XXXXXX")"
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

fetch_checked   "https://github.com/termux/proot/archive/v${PROOT_VERSION}.zip"   "$WORK/proot.zip"   "$PROOT_SHA256"
fetch_checked   "https://www.samba.org/ftp/talloc/talloc-${TALLOC_VERSION}.tar.gz"   "$WORK/talloc.tar.gz"   "$TALLOC_SHA256"

build_abi() {
  local abi="$1" triple="$2"
  local cc="$TOOLCHAIN/${triple}${API}-clang"
  local ar="$TOOLCHAIN/llvm-ar"
  local strip="$TOOLCHAIN/llvm-strip"
  local abi_work="$WORK/$abi"
  local prefix="$abi_work/prefix"
  local wrappers="$abi_work/tool-wrappers"

  mkdir -p "$abi_work/proot" "$abi_work/talloc" "$prefix/lib" "$prefix/include" "$wrappers"
  ln -s "$TOOLCHAIN/llvm-readelf" "$wrappers/readelf"
  unzip -q "$WORK/proot.zip" -d "$abi_work/proot-source"
  tar -xzf "$WORK/talloc.tar.gz" -C "$abi_work/talloc" --strip-components=1
  patch -d "$abi_work/proot-source/proot-${PROOT_VERSION}" -p1     < "$ROOT/tools/embedded-runtime/proot-ndk28.patch"

  (
    cd "$abi_work/talloc"
    CC="$cc" AR="$ar" RANLIB="$TOOLCHAIN/llvm-ranlib"       ./configure         --prefix="$prefix"         --disable-rpath         --disable-python         --cross-compile         --cross-answers="$ROOT/tools/embedded-runtime/proot-cross-answers.txt"
    make -j"${AGENTUI_BUILD_JOBS:-2}"
    "$ar" rcs "$prefix/lib/libtalloc.a" bin/default/talloc*.o
    install -m 644 talloc.h "$prefix/include/talloc.h"
  )

  local proot_source="$abi_work/proot-source/proot-${PROOT_VERSION}"
  (
    cd "$proot_source"
    PATH="$wrappers:$PATH" make       -C src       CC="$cc"       LD="$cc"       STRIP="$strip"       OBJCOPY="$TOOLCHAIN/llvm-objcopy"       OBJDUMP="$TOOLCHAIN/llvm-objdump"       CPPFLAGS="-D_FILE_OFFSET_BITS=64 -D_GNU_SOURCE -DARG_MAX=131072 -DVERSION=\\\"${PROOT_VERSION}\\\" -I. -I$prefix/include"       CFLAGS="-Wall -Wextra -O2"       LDFLAGS="-L$prefix/lib -ltalloc -Wl,-z,noexecstack"
    "$strip" src/proot
  )

  local asset_dir="$MODULE_ROOT/assets/runtime/$abi"
  local jni_dir="$MODULE_ROOT/jniLibs/$abi"
  mkdir -p "$asset_dir" "$jni_dir"
  install -m 755 "$proot_source/src/proot" "$asset_dir/proot"
  install -m 755 "$proot_source/src/loader/loader" "$jni_dir/libproot_loader.so"

  echo "$abi proot: $(sha256_file "$asset_dir/proot")"
  echo "$abi loader: $(sha256_file "$jni_dir/libproot_loader.so")"
}

if [[ "$#" -eq 0 ]]; then set -- arm64-v8a; fi

for abi in "$@"; do
  case "$abi" in
    arm64-v8a) build_abi "$abi" aarch64-linux-android ;;
    armeabi-v7a) build_abi "$abi" armv7a-linux-androideabi ;;
    x86_64) build_abi "$abi" x86_64-linux-android ;;
    *) echo "Unsupported ABI: $abi" >&2; exit 2 ;;
  esac
done
