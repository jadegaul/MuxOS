import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import type { DbExecutor } from "@plugins/database/server";
import {
  TOKEN_KINDS,
  type UsageSpeed,
} from "@plugins/infra/plugins/claude-cli/plugins/usage-ledger/core";
import { _claudeUsageHours } from "@plugins/infra/plugins/claude-cli/plugins/usage-ledger/server";
import {
  priceVersionIdKind,
  resolveModel,
  type ModelPrice,
  type PriceTable,
  type PriceVersionId,
  type PriceVersionSource,
} from "../../core";
import { _claudeModelRates, _claudePriceVersions } from "./tables";

type RateRow = typeof _claudeModelRates.$inferInsert;

/** Each kind's (base, tiered) rate in `ModelPrice`. */
const PRICE_FIELDS = {
  input: ["input", "inputAbove200k"],
  output: ["output", "outputAbove200k"],
  cacheRead: ["cacheRead", "cacheReadAbove200k"],
  cacheCreate5m: ["cacheCreate5m", "cacheCreate5mAbove200k"],
  cacheCreate1h: ["cacheCreate1h", "cacheCreate1hAbove200k"],
} as const satisfies Record<
  (typeof TOKEN_KINDS)[number],
  readonly [keyof ModelPrice, keyof ModelPrice]
>;

/**
 * The materialized rates of `price` for one observed model and speed: the
 * base rate below the tier, the tiered one above it (the base when the model
 * is untiered — `priceBucket`'s rule), times the fast multiplier on `fast`
 * (×1 when the model has none).
 */
export function ratesOf(
  versionId: PriceVersionId,
  model: string,
  speed: UsageSpeed,
  price: ModelPrice,
): RateRow {
  const m = speed === "fast" ? (price.fastMultiplier ?? 1) : 1;
  const tier = (kind: keyof typeof PRICE_FIELDS) => {
    const [base, tiered] = PRICE_FIELDS[kind];
    const below = price[base] ?? 0;
    return { below: below * m, above: (price[tiered] ?? below) * m };
  };
  const input = tier("input");
  const output = tier("output");
  const cacheRead = tier("cacheRead");
  const create5m = tier("cacheCreate5m");
  const create1h = tier("cacheCreate1h");
  return {
    versionId,
    model,
    speed,
    inputBelow: input.below,
    inputAbove: input.above,
    outputBelow: output.below,
    outputAbove: output.above,
    cacheReadBelow: cacheRead.below,
    cacheReadAbove: cacheRead.above,
    cacheCreate5mBelow: create5m.below,
    cacheCreate5mAbove: create5m.above,
    cacheCreate1hBelow: create1h.below,
    cacheCreate1hAbove: create1h.above,
  };
}

const SPEEDS: readonly UsageSpeed[] = ["standard", "fast"];

/** Both speeds' rate rows for each model `table` resolves (an unresolved one has none). */
function rateRows(
  versionId: PriceVersionId,
  table: PriceTable["models"],
  models: Iterable<string>,
): RateRow[] {
  const lookup: PriceTable = { fetchedAt: 0, models: table };
  const rows: RateRow[] = [];
  for (const model of models) {
    const price = resolveModel(lookup, model);
    if (price === null) continue;
    for (const speed of SPEEDS)
      rows.push(ratesOf(versionId, model, speed, price));
  }
  return rows;
}

/** Postgres caps a statement's bind parameters at 65535; a rate row has 13. */
const RATE_ROWS_PER_INSERT = 2_000;

async function insertRates(exec: DbExecutor, rows: RateRow[]): Promise<void> {
  for (let i = 0; i < rows.length; i += RATE_ROWS_PER_INSERT)
    await exec
      .insert(_claudeModelRates)
      .values(rows.slice(i, i + RATE_ROWS_PER_INSERT))
      .onConflictDoNothing();
}

/** Every model string the ledger holds. */
async function observedModels(exec: DbExecutor): Promise<string[]> {
  const rows = await exec
    .selectDistinct({ model: _claudeUsageHours.model })
    .from(_claudeUsageHours);
  return rows.map((r) => r.model);
}

/** `value` as JSON with sorted keys, so two tables compare by content. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export type RecordedPriceVersion =
  | { kind: "recorded"; id: PriceVersionId; effectiveFrom: "-infinity" | Date }
  | { kind: "unchanged"; id: PriceVersionId };

/**
 * Record `table` as the price version in force from now on — only when some
 * rate differs from the newest refreshed (non-correction) version's table; the
 * first version ever is effective from `-infinity`. A recorded version prices
 * every model the ledger holds (`resolveModel`, once), plus the caller's local
 * endpoint models at their $0 rate. Either way every observed model missing
 * from any version is priced (`priceModels`'s sweep), so a model first seen by
 * a write whose own pricing was lost is caught here.
 *
 * Compared against the newest REFRESHED version, not a correction: a hand
 * correction never makes an unchanged upstream table look new.
 */
export async function recordPriceVersion(
  exec: DbExecutor,
  table: PriceTable,
  source: Exclude<PriceVersionSource, "correction">,
  endpointModels: Iterable<string> = [],
  now: Date = new Date(),
): Promise<RecordedPriceVersion> {
  const result = await exec.transaction(async (tx) => {
    // One recorder at a time: two backends refreshing at once must not both
    // record the same change.
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext('claude_price_versions'))`,
    );
    const [newest] = await tx
      .select({
        id: _claudePriceVersions.id,
        models: _claudePriceVersions.models,
      })
      .from(_claudePriceVersions)
      .where(ne(_claudePriceVersions.source, "correction"))
      .orderBy(
        desc(_claudePriceVersions.effectiveFrom),
        desc(_claudePriceVersions.id),
      )
      .limit(1);
    if (
      newest !== undefined &&
      canonical(newest.models) === canonical(table.models)
    )
      return { kind: "unchanged", id: newest.id } as const;
    const [any] = await tx
      .select({ id: _claudePriceVersions.id })
      .from(_claudePriceVersions)
      .limit(1);
    const effectiveFrom = any === undefined ? ("-infinity" as const) : now;
    const id = priceVersionIdKind.mint();
    await tx.insert(_claudePriceVersions).values({
      id,
      effectiveFrom:
        effectiveFrom === "-infinity"
          ? "-infinity"
          : effectiveFrom.toISOString(),
      source,
      models: table.models,
    });
    await insertRates(tx, rateRows(id, table.models, await observedModels(tx)));
    return { kind: "recorded", id, effectiveFrom } as const;
  });
  await priceModels(exec, [...(await observedModels(exec)), ...endpointModels]);
  return result;
}

/**
 * The price a local endpoint's own model carries in every version: $0 across
 * the board. The price table (LiteLLM's Claude rates) has never carried a
 * machine's own model names, and never will — without this row their tokens
 * would read unpriced (NULL, `cost-unpriced-model`) forever. The rate is a
 * FACT about where the tokens were drawn (a local inference cost nothing the
 * user), so it is materialized like any other rate, in every version.
 */
const ZERO_PRICE: ModelPrice = {
  input: 0,
  output: 0,
  cacheCreate5m: 0,
  cacheCreate1h: 0,
  cacheRead: 0,
};

/** Zero-rate rows for the endpoint models among `models`, for one version. */
function endpointZeroRows(
  versionId: PriceVersionId,
  models: Iterable<string>,
): RateRow[] {
  const rows: RateRow[] = [];
  for (const model of models) {
    for (const speed of SPEEDS)
      rows.push(ratesOf(versionId, model, speed, ZERO_PRICE));
  }
  return rows;
}

/**
 * Price `models` in every version that lacks them: each resolved against the
 * version's own table (`resolveModel`), its rates written once (a row already
 * there is kept). A model a version cannot resolve gets no row there — its
 * hours read an unpriced (NULL) cost — EXCEPT the local endpoint models the
 * caller passes (`endpointModels`), which price at $0 in every version
 * instead: the table will never learn them, and their tokens are not to be
 * left unpriced. The names come from the caller — the accounts file is the
 * machine half's, and this plugin stays a portable leaf over the database.
 * Idempotent; the ledger's writers call it with the models a write named
 * (`ensureModelRates` skips the known ones), and `recordPriceVersion` calls
 * it with every observed model, so a version recorded later carries the
 * endpoint rates too.
 */
export async function priceModels(
  exec: DbExecutor,
  models: Iterable<string>,
  endpointModels: Iterable<string> = [],
): Promise<void> {
  const wanted = [...new Set([...models, ...endpointModels])];
  if (wanted.length === 0) return;
  const versions = await exec
    .select({
      id: _claudePriceVersions.id,
      models: _claudePriceVersions.models,
    })
    .from(_claudePriceVersions);
  if (versions.length === 0) return;
  const endpoint = new Set(endpointModels);
  const have = await exec
    .select({
      versionId: _claudeModelRates.versionId,
      model: _claudeModelRates.model,
    })
    .from(_claudeModelRates)
    .where(
      and(
        inArray(_claudeModelRates.model, wanted),
        eq(_claudeModelRates.speed, "standard"),
      ),
    );
  const priced = new Set(have.map((r) => `${r.versionId}\0${r.model}`));
  const rows = versions.flatMap((v) =>
    rateRows(
      v.id,
      v.models,
      wanted.filter((m) => !priced.has(`${v.id}\0${m}`) && !endpoint.has(m)),
    ),
  );
  // The endpoint models' zero rates, beside whatever the table resolved: a
  // model the table resolves is never an endpoint model's (the map's names
  // are the endpoint's own, not Claude's).
  for (const v of versions) {
    const zeros = endpointZeroRows(
      v.id,
      wanted.filter((m) => endpoint.has(m) && !priced.has(`${v.id}\0${m}`)),
    );
    if (zeros.length > 0) rows.push(...zeros);
  }
  await insertRates(exec, rows);
}

/**
 * Models this process already priced (or found unpriceable) in every version
 * it knew of: a ledger write naming only these does no read at all. A version
 * recorded later prices every observed model itself (`recordPriceVersion`).
 */
const known = new Set<string>();

/**
 * Make sure every model a ledger write named has its rates in every price
 * version — called by each writer right after its write lands, so a model
 * first seen is priced at once rather than reading unpriced until the next
 * refresh. The writer passes the local endpoint's model names too
 * (`endpointAccountModels`, the machine half's read of the accounts file): an
 * endpoint's own model is not in the price table, and its first sight prices
 * it at $0. A cheap no-op for models this process has seen.
 */
export async function ensureModelRates(
  exec: DbExecutor,
  models: Iterable<string>,
  endpointModels: Iterable<string> = [],
): Promise<void> {
  const fresh = [...new Set(models)].filter((m) => !known.has(m));
  if (fresh.length === 0) return;
  await priceModels(exec, fresh, endpointModels);
  for (const m of fresh) known.add(m);
}
