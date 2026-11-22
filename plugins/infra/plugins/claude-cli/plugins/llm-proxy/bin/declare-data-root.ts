import { declareDataRootLayoutSync } from "@plugins/infra/plugins/paths/plugins/data-root-layout/core";

// ── Before anything reads a path: decide where the data root is ──────────────
//
// The proxy is the root of its own process tree: the host singleton's backend
// starts it detached under its own environment, which carries no data-root
// declaration, and it outlives any one backend. So it decides the layout from
// the disk itself, first thing, before the accounts file or the pid file is
// read (infra/paths CLAUDE.md, § The data root). A blocking read, once.
declareDataRootLayoutSync();
