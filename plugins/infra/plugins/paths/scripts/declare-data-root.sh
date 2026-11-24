# shellcheck shell=sh
# Sourced by ./muxos before it execs the CLI: decide the home data root's
# layout from the disk and export it as MUXOS_DATA_ROOT_LAYOUT, so every
# process the CLI starts — a Bun child with no explicit env included, which
# gets its parent's STARTING environment — inherits a decided root instead of
# reading the disk on its own (infra/paths CLAUDE.md, § The data root).
#
# The shell twin of paths/data-root-layout decideDataRootLayout (data-root-layout.ts), case
# for case, held to it by declare-data-root-sh.test.ts; the tokens are
# HOME_LAYOUT_TOKENS. Two roots (a split) is left undeclared: the CLI's own
# decision throws DataRootSplitError, which names what to do.
#
# Conditionals only: ./muxos runs under `set -e`, and nothing here may abort it.
unset MUXOS_DATA_ROOT_LAYOUT
if [ -z "${MUXOS_DIR:-}" ]; then
  _muxos_current="$HOME/.muxos"
  _muxos_legacy="$HOME/.equin"
  if ! [ -e "$_muxos_legacy" ] && ! [ -L "$_muxos_legacy" ]; then
    MUXOS_DATA_ROOT_LAYOUT=current
  elif [ -L "$_muxos_legacy" ] && [ "$_muxos_legacy" -ef "$_muxos_current" ]; then
    MUXOS_DATA_ROOT_LAYOUT=current-legacy-link
  elif ! [ -e "$_muxos_current" ] && ! [ -L "$_muxos_current" ]; then
    MUXOS_DATA_ROOT_LAYOUT=legacy
  fi
  unset _muxos_current _muxos_legacy
fi
if [ -n "${MUXOS_DATA_ROOT_LAYOUT:-}" ]; then
  export MUXOS_DATA_ROOT_LAYOUT
fi
