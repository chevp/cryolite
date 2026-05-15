#!/usr/bin/env bash
# Build the cryolite wasm artifacts: engine.mjs + engine.wasm.
#
# Statically links Lua 5.4 (fetched on demand) and the nuna-middleware
# source. Outputs to wasm/ at the package root, where consuming apps can
# pick the .mjs up as a module factory and pass it to FrostEngine.create.
#
# Requires emscripten (emcc on PATH) and the nuna-middleware repo
# checked out somewhere reachable.

set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
PKG_ROOT="$(cd "$HERE/.." && pwd)"

LUA_VERSION="${LUA_VERSION:-5.4.7}"
MIDDLEWARE_DIR="${NUNA_MIDDLEWARE_DIR:-$PKG_ROOT/../../nuna/nuna-middleware}"

VENDOR="$HERE/vendor"
LUA_SRC="$VENDOR/lua-$LUA_VERSION/src"
OUT_DIR="$PKG_ROOT/wasm"

if [ ! -f "$MIDDLEWARE_DIR/src/middleware.cpp" ]; then
  echo "nuna-middleware not found at $MIDDLEWARE_DIR" >&2
  echo "set NUNA_MIDDLEWARE_DIR or check out chevp/nuna-middleware as a sibling" >&2
  exit 1
fi

if ! command -v emcc >/dev/null 2>&1; then
  echo "emcc not found on PATH — install and activate emsdk first" >&2
  exit 1
fi

mkdir -p "$VENDOR" "$OUT_DIR"

if [ ! -d "$LUA_SRC" ]; then
  echo "fetching Lua $LUA_VERSION..."
  curl -fsSL "https://www.lua.org/ftp/lua-$LUA_VERSION.tar.gz" -o "$VENDOR/lua.tar.gz"
  tar -xzf "$VENDOR/lua.tar.gz" -C "$VENDOR"
  rm "$VENDOR/lua.tar.gz"
fi

LUA_SRCS=()
for f in "$LUA_SRC"/*.c; do
  case "$(basename "$f")" in
    lua.c|luac.c|onelua.c|ltests.c) ;;
    *) LUA_SRCS+=("$f") ;;
  esac
done

EXPORTS=(
  _engine_init
  _engine_add_entity
  _engine_set_position
  _engine_set_scale
  _engine_set_color
  _engine_set_property
  _engine_attach_script
  _engine_tick
  _engine_get_entity_count
  _engine_get_entity_id
  _engine_get_entity_x
  _engine_get_entity_y
  _engine_get_entity_z
  _engine_get_entity_scale_x
  _engine_get_entity_scale_y
  _engine_get_entity_scale_z
  _engine_get_entity_color
  _nuna_middleware_produce_frame_flat
  _nuna_middleware_version
  _malloc
  _free
)
EXPORTS_JOINED=$(IFS=,; echo "${EXPORTS[*]}")

echo "compiling cryolite wasm..."
emcc -O2 -std=c++17 \
  -I"$LUA_SRC" -I"$MIDDLEWARE_DIR/include" \
  "$HERE/engine.cpp" \
  "$MIDDLEWARE_DIR/src/middleware.cpp" \
  "${LUA_SRCS[@]}" \
  -o "$OUT_DIR/engine.mjs" \
  -sMODULARIZE=1 -sEXPORT_ES6=1 \
  -sALLOW_MEMORY_GROWTH=1 \
  -sEXPORTED_RUNTIME_METHODS=ccall,cwrap,UTF8ToString,HEAPF32 \
  -sEXPORTED_FUNCTIONS="$EXPORTS_JOINED"

echo "built: $OUT_DIR/engine.mjs, $OUT_DIR/engine.wasm"
