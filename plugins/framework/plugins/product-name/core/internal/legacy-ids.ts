// The identifiers built from the product's old name that are KEPT for good.
//
// Each one is stored state (a database, a keychain item, a lock file, a key in
// someone's localStorage, a line in a remote's authorized_keys) or a contract
// that processes on different versions rely on (a lock dir every checkout
// shares, a header a stale tab keeps sending). Renaming one splits or loses
// that state, so it stays — and it is spelled HERE and nowhere else: every
// consumer imports it, and `product-name:legacy-id` rejects the old name in any
// other tracked file.
//
// A name that is produced and consumed by the same build (a package scope, a
// camelCase identifier, a temp prefix) is not kept: it is renamed to
// `PRODUCT_NAME`. The decision, family by family:
// research/2026-10-25-global-equin-internal-identifiers.md.

export const LEGACY_IDS = {
  /** The main namespace: its database, socket, logs and state dirs, the main composition id. */
  mainNamespace: "singularity",
  /** The embedded cluster's Postgres role. */
  pgUser: "singularity",
  /** The cluster's base database (every worktree DB is forked from it). */
  pgBaseDatabase: "singularity",
  /** The macOS keychain service holding the secrets master key. */
  keychainService: "singularity",
  /** The gateway's code-signing identifier (TCC grants are keyed on it). */
  codesignIdentifier: "dev.singularity.gateway",
  /** The gateway's launchd / systemd label before the data-dir migration (`./muxos data-dir migrate`). */
  launchdLabel: "dev.equin.gateway",
  /** The data root's dir name under the home dir before the data-dir migration (`~/<dir>`). */
  dataDirName: ".equin",
  /** The trailer naming the conversation a commit came from. */
  conversationTrailer: "Singularity-Conversation",
  /** The trailer naming the push a commit landed with. */
  pushTrailer: "Singularity-Push",
  /** The section of every checkout's git config the app writes keys under. */
  gitConfigSection: "singularity",
  /** The domain of the auto-assigned commit e-mail (`<x>@<domain>`). */
  autoIdentityDomain: "singularity.invalid",
  /** The git-dir dir holding the host-wide semaphore slot files. */
  gitLockDir: "singularity-locks",
  /** The git-dir dir holding conflict-marker records of a rebase. */
  mergeMarkersDir: "singularity-merge-markers",
  /** The ref pushed (and deleted) to probe write access to a remote. */
  writeProbeRef: "refs/heads/singularity-write-probe",
  /** The lock reason of an agent worktree (`git worktree lock --reason`). */
  worktreeLockReason: "singularity agent worktree",
  /** The lock reason of a spare (pre-created) worktree. */
  spareLockReason: "singularity-spare",
  /** The prefix of the app's own DB objects (`__<p>_migrations`, `<p>_mark_superseded()`, GUC `<p>.superseded`). */
  dbObjectPrefix: "singularity",
  /** The tag of the markers in migration SQL (`-- <tag>:snapshot`, `-- <tag>:phase`, …). */
  migrationMarker: "singularity",
  /** The prefix of the app's HTTP headers (`<p>origin`, `<p>agent-write`, …). */
  headerPrefix: "x-singularity-",
  /** The prefix of the app's drag-and-drop MIME types. */
  mimePrefix: "application/x-singularity-",
  /** The prefix of browser-side keys and names: localStorage, IndexedDB, SharedWorker / port names, window messages. */
  browserKeyPrefix: "singularity",
  /** The prefix of the globals content-addressed web artifacts read (`<p>GRAPH__`, `<p>COMMIT__`). */
  artifactGlobalPrefix: "__SINGULARITY_",
  /** The OAuth popup's window name. */
  authPopupName: "singularity-auth",
  /** The message the OAuth callback page posts to its opener. */
  authCompleteMessage: "singularity.auth.complete",
  /** The agent browser's Playwright endpoint name. */
  agentBrowserName: "singularity-agent-browser",
  /** The backup source holding the platform's own data. */
  backupPlatformSource: "singularity-platform",
  /** The file explorer's place for the repo checkout. */
  fileExplorerPlace: "singularity",
  /** The comment of a deploy SSH key (`<p><server id>`). */
  deployKeyCommentPrefix: "singularity-deploy-",
  /** The legacy CLI names, still shims at the repo root (each forwards to `./muxos`). */
  cliShims: ["equin", "singularity"],
  /** The main namespace's previous-generation public host label: pre-rename agent env, bookmarks and transcripts still dial it; it resolves to the main namespace (`namespace` LEGACY_HOST_ALIASES) and goes when nothing dials it (rename track, Step 9). */
  mainHostAlias: "equin",
  /** The npm scope of the published platform-binary packages (`@equin/pgbouncer-*`, `@equin/pg-client-*`): installs pin them by name on the registry, so the scope outlives the rename (the workspace's own `@muxos/*` names are a same-build id and were renamed). */
  npmScope: "@equin",
  /** The default checkout dir of a fresh install (`~/<dir>`). */
  defaultCheckoutDir: "singularity",
  /** The backups dir under the home dir (`~/.backups/<dir>`). */
  backupsDirName: "singularity",
} as const;

export type LegacyIdKey = keyof typeof LEGACY_IDS;

export interface LegacyIdNote {
  /** Why it is kept: what stores it, or which processes on different versions read it. */
  readonly kept: string;
  /**
   * Repo files that cannot import this leaf (Go, Rust, shell, a standalone
   * script) and so spell the value themselves. A mirror must keep containing it
   * — `product-name:legacy-id` asserts it — and is the only file outside this
   * leaf where a line naming it may stand.
   */
  readonly mirrors?: readonly string[];
}

export const LEGACY_ID_NOTES: Readonly<Record<LegacyIdKey, LegacyIdNote>> = {
  mainNamespace: {
    kept: "the main namespace's database, socket, data dirs and stored rows",
    mirrors: [
      "gateway/proxy.go",
      "gateway/worktree.go",
      "install.sh",
      "plugins/companions/plugins/menu-bar/rust/src/cli.rs",
      "sidequests/claude-web/session-picker.sh",
      "sidequests/clean-install/steps.sh",
      "sidequests/clean-install/steps-install.sh",
    ],
  },
  pgUser: {
    kept: "the role every worktree database is owned by",
    mirrors: ["sidequests/clean-install/steps.sh"],
  },
  pgBaseDatabase: {
    kept: "the cluster's existing base database",
    mirrors: [
      "sidequests/claude-web/session-picker.sh",
      "sidequests/clean-install/steps.sh",
    ],
  },
  keychainService: {
    kept: "holds the secrets master key; losing it loses every secret",
  },
  codesignIdentifier: {
    kept: "TCC grants are keyed on it; renaming re-prompts every permission",
  },
  launchdLabel: {
    kept: "the installed service of an install not yet migrated; the gateway's login service stays bound to it while its definition is installed, until `./muxos data-dir migrate` relabels it",
    mirrors: ["install.sh"],
  },
  dataDirName: {
    kept: "the data root of an install not yet migrated; it is used while it exists, until `./muxos data-dir migrate` moves it (paths/data-root-layout dataRootLayout)",
    mirrors: [
      "gateway/dataroot.go",
      "install.sh",
      "plugins/framework/plugins/cli/plugins/doctor/doctor.sh",
      "plugins/infra/plugins/paths/scripts/declare-data-root.sh",
      "sidequests/monitors/fd/fd-monitor.sh",
      "sidequests/clean-install/run.sh",
      "sidequests/clean-install/steps-migrate.sh",
    ],
  },
  conversationTrailer: {
    kept: "written into every commit in history",
    mirrors: [".githooks/prepare-commit-msg"],
  },
  pushTrailer: { kept: "written into every commit in history" },
  gitConfigSection: {
    kept: "keys in every checkout's .git/config, read by mixed versions",
  },
  autoIdentityDomain: { kept: "in the author e-mail of existing commits" },
  gitLockDir: {
    kept: "shared by every worktree on mixed versions; renaming splits the lock",
    // The guard hook's bootstrap may import nothing from the repo
    // (guards:bootstrap-builtins-only); its test holds the copy to this value.
    mirrors: [
      "plugins/framework/plugins/tooling/plugins/guards/bin/bootstrap.ts",
    ],
  },
  mergeMarkersDir: {
    kept: "shared by every worktree on mixed versions",
    mirrors: [
      ".githooks/post-rewrite",
      "plugins/framework/plugins/cli/scripts/regen-claudemd.sh",
      "plugins/framework/plugins/cli/scripts/regen-generated.sh",
      "plugins/framework/plugins/cli/scripts/regen-migrations.sh",
    ],
  },
  writeProbeRef: { kept: "a ref name older checkouts may leave behind" },
  worktreeLockReason: { kept: "written into existing worktrees' lock files" },
  spareLockReason: {
    kept: "written into existing spares' lock files, and how a spare is recognised",
  },
  dbObjectPrefix: {
    kept: "tables, functions and settings in every database",
    mirrors: [
      "sidequests/claude-web/session-picker.sh",
      "sidequests/clean-install/steps.sh",
    ],
  },
  migrationMarker: { kept: "in every committed migration's SQL" },
  headerPrefix: { kept: "a tab open across a deploy keeps sending it" },
  mimePrefix: { kept: "a drag between tabs on different versions" },
  browserKeyPrefix: {
    kept: "browser-local data (drafts, tab ids, IndexedDB) and names tabs on different versions share",
  },
  artifactGlobalPrefix: {
    kept: "content-addressed artifacts from older builds read these globals",
  },
  authPopupName: {
    kept: "the popup and its opener can be on different versions",
  },
  authCompleteMessage: {
    kept: "the callback page and its opener can be on different versions",
  },
  agentBrowserName: { kept: "agent sessions on older versions attach by it" },
  backupPlatformSource: { kept: "backup run rows and archive layouts" },
  fileExplorerPlace: { kept: "stored place selections" },
  deployKeyCommentPrefix: {
    kept: "in the authorized_keys of every configured server",
  },
  cliShims: {
    kept: "the `./equin` and `./singularity` shims old transcripts and muscle memory call; both forward to ./muxos",
    mirrors: ["plugins/framework/plugins/cli/package.json"],
  },
  mainHostAlias: {
    kept: "a pre-rename EQUIN_…PARENT_URL value, bookmark or transcript still dials equin.localhost; it resolves to the main namespace until nothing dials it (rename track, Step 9)",
    mirrors: ["gateway/proxy.go"],
  },
  npmScope: {
    kept: "platform-binary packages published to npm under this scope; every install pins them by registry name, so a rename would break installs of a build that predates the new scope",
    mirrors: [
      "package.json",
      "plugins/database/plugins/pgbouncer/package.json",
      "plugins/database/plugins/pgbouncer/plugins/publish-watch/package.json",
      "plugins/database/plugins/pgbouncer/plugins/binary/package.json",
      "plugins/database/plugins/client-tools/package.json",
      "plugins/database/plugins/client-tools/plugins/publish-watch/package.json",
    ],
  },
  defaultCheckoutDir: {
    kept: "existing installs' checkout dir, which is never moved (git worktrees store absolute gitdirs); install.sh clones new installs to ~/muxos",
    mirrors: [
      ".vscode/settings.json",
      "sidequests/claude-web/com.epot.claude-new.plist",
      "sidequests/claude-web/com.epot.claude-picker.plist",
      "sidequests/monitors/fd/com.epot.fd-monitor.plist",
      "sidequests/clean-install/steps.sh",
      "sidequests/clean-install/steps-migrate.sh",
    ],
  },
  backupsDirName: {
    kept: "the local backups of an install not yet migrated; used while it exists, until `./equin data-dir migrate` moves it (paths/core backupsDir)",
  },
};
