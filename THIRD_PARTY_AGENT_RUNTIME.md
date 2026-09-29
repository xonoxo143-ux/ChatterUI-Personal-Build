# Embedded agent runtime: third-party components

The optional embedded workspace runtime is built from upstream open-source components. ChatterUI's
own license does not relicense these components.

## PRoot

- Project: https://github.com/termux/proot
- Version pinned by our build: 5.1.107.86
- Build script: `tools/embedded-runtime/build-proot-assets.sh`

The build downloads the exact upstream source archive, verifies its SHA-256, applies the small
Android-NDK compatibility patch kept next to the script, and builds the Android binary and static
loader. PRoot keeps its upstream license terms.

## talloc

- Project: https://www.samba.org/talloc/
- Version pinned by our build: 2.4.3
- Used by the PRoot build.
- The exact upstream source archive and checksum are recorded in the build script.

## GNU tar

- Project: https://www.gnu.org/software/tar/
- Version pinned by our build: 1.35
- Upstream license: GPL-3.0-or-later.
- Build script: `tools/embedded-runtime/build-gnu-tar-assets.sh`

The tar build also uses Android glob compatibility source from a pinned Termux packages commit.
Exact source references and checksums are recorded in the build script.

## Linux root filesystems

Root filesystems are downloaded on demand instead of being bundled into the APK. Each distro keeps
its own upstream licensing and package metadata. The app verifies a pinned SHA-256 before installing
a rootfs.

## Implementation references

The Android execution design was informed by the MIT-licensed uDroid project and the Apache-2.0
Conduit project. In particular, modern Android requires special care when executing app-private ELF
files: the embedded PRoot executable is launched through Android's system linker and PRoot's helper
loader is packaged as an extracted native library.

This file is not a substitute for the license texts or corresponding-source obligations that apply
when publishing binaries. Release packaging should include the applicable upstream notices and
source-offer material.
