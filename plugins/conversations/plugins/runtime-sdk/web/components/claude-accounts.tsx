import { useState, type ReactNode } from "react";
import { transient } from "@plugins/primitives/plugins/kept-state/core";
import {
  EndpointError,
  getEndpointErrorMessage,
  useEndpointMutation,
  useFetchEndpoint,
} from "@plugins/infra/plugins/endpoints/web";
import {
  addClaudeAccount,
  addClaudeEndpoint,
  removeClaudeAccount,
  selectClaudeAccount,
  testClaudeEndpoint,
  SYSTEM_ACCOUNT_ID,
  API_KEY_PREFIXES,
  ENDPOINT_APIS,
  type ClaudeAccounts,
  type EndpointApi,
} from "@plugins/infra/plugins/claude-cli/plugins/accounts/core";
import {
  MODEL_TIERS,
  modelDisplayLabel,
  type ModelMap,
  type ModelTier,
} from "@plugins/conversations/plugins/model-provider/core";
import type { ClaudeCodeStatus } from "@plugins/infra/plugins/claude-cli/plugins/availability/core";
import { useConfigResult, useSetConfig } from "@plugins/config_v2/web";
import { Avatar } from "@plugins/primitives/plugins/avatar/web";
import { ResourceErrorInline } from "@plugins/network/plugins/live/plugins/live-state/web";
import { Loading } from "@plugins/primitives/plugins/loading/web";
import { Fill } from "@plugins/primitives/plugins/css/plugins/fill/web";
import { Line } from "@plugins/primitives/plugins/css/plugins/line/web";
import { ControlPanel } from "@plugins/primitives/plugins/css/plugins/control-panel/web";
import { Stack } from "@plugins/primitives/plugins/css/plugins/spacing/web";
import { Text } from "@plugins/primitives/plugins/css/plugins/text/web";
import {
  Button,
  cn,
  ControlSizeProvider,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@plugins/primitives/plugins/css/plugins/ui-kit/web";
import { IconButton } from "@plugins/primitives/plugins/icon-button/web";
import {
  StepAction,
  StepActions,
  StepLink,
  StepNote,
} from "@plugins/primitives/plugins/setup-steps/web";
import { symbol } from "@plugins/ui/plugins/icons/core";
import { ForAudience } from "@plugins/audience/plugins/developer-mark/web";
import {
  autoResumeConfig,
  limitReached,
  refreshClaudeUsage,
  roomiestAccount,
  usageLevel,
  weekRoom,
  type ClaudeUsageRead,
  type ErrorStoppedConversation,
} from "../../core";
import { formatResets, USAGE_WINDOWS } from "../internal/claude-usage";
import {
  accountViews,
  activeAccountView,
  type AccountView,
} from "../internal/account-views";
import { AccountHead, LEVEL_CLASS } from "./account-head";
import { UsageBar } from "./claude-usage-glance";
import { ErrorStoppedBanner } from "./error-stopped";

// The Claude account menu's accounts (the agent manager's sidebar foot): which
// Claude account new agents launch on: the computer's own Claude Code login —
// the only plan account — an API key the user added, or a local model endpoint
// (the user's own model server: OpenAI-compatible through equin's translator
// proxy, or Anthropic-shaped direct).
// The computer's login shows its weekly room only — the 5-hour session resets
// too often to read at a glance. Picking one switches; agents already running
// keep theirs until their process restarts. Picking the computer's login reads
// its limits at once (no agent turn needed). An added account has no plan
// limits: an API key is billed to its Console org (e.g. the plan's monthly API
// credit), a local endpoint runs on the user's own hardware (its tokens cost
// $0). Nothing switches accounts on its own.

const addIcon = symbol("add");
const removeIcon = symbol("close");

const percent = (fraction: number) => `${Math.round(fraction * 100)}%`;

/**
 * Where this tab's own read of an account's limits stands: `reading` while it
 * runs, `unreadable` (with why) when Claude Code had no plan limits for it.
 */
type UsageRead =
  | { kind: "idle" }
  | { kind: "reading" }
  | { kind: "unreadable"; reason: string };

/** One account's weekly room, as words and a bar. */
function WeekRoomGlance({
  account,
  usage,
  read,
  now,
}: {
  account: AccountView;
  usage: ClaudeUsageRead;
  read: UsageRead;
  now: number;
}) {
  if (account.kind === "api-key")
    return (
      <Text
        variant="caption"
        tone="muted"
        title="An API key has no plan limits: each request is billed to its Console organization — its monthly API credit first"
      >
        Billed to API credit
      </Text>
    );
  if (account.kind === "endpoint")
    return (
      <Text
        variant="caption"
        tone="muted"
        title="Runs on a model server you run: no Claude billing, and its tokens cost $0"
      >
        Local model
      </Text>
    );
  const reading = usage.byAccount[account.id];
  const room = weekRoom(reading, now);
  if (room.kind === "unknown") {
    switch (read.kind) {
      case "reading":
        return (
          <Text variant="caption" tone="faint">
            Reading usage…
          </Text>
        );
      case "unreadable":
        return (
          <Text variant="caption" tone="faint" title={read.reason}>
            Usage not readable
          </Text>
        );
      case "idle":
        return (
          <Text variant="caption" tone="faint">
            No reading yet
          </Text>
        );
    }
  }
  const used = 1 - room.left;
  const reached = limitReached(reading, now) !== null;
  const level = reached ? "full" : usageLevel(used);
  return (
    <Stack gap="xs" align="end">
      <div className="w-14">
        <UsageBar
          fraction={used}
          level={level}
          label="Week usage"
          size="thin"
        />
      </div>
      <Text
        variant="caption"
        tone="muted"
        className={cn("tabular-nums", LEVEL_CLASS[level])}
      >
        {reached ? "Limited" : `${percent(room.left)} left`}
      </Text>
    </Stack>
  );
}

/**
 * The active account hit a limit: say until when. A developer is also offered
 * the roomiest other account — a manual switch, never made for anyone else:
 * moving between plan accounts to get around their limits is against
 * Anthropic's terms (`infra/claude-cli/accounts`).
 */
function LimitBanner({
  views,
  active,
  usage,
  now,
  onSwitch,
}: {
  views: AccountView[];
  active: AccountView;
  usage: ClaudeUsageRead;
  now: number;
  onSwitch: (id: string) => void;
}) {
  const reached = limitReached(usage.byAccount[active.id], now);
  if (!reached) return null;
  const nextId = roomiestAccount(
    views.filter((v) => v.id !== active.id),
    usage.byAccount,
    now,
  );
  const next = views.find((v) => v.id === nextId);
  const room = next ? weekRoom(usage.byAccount[next.id], now) : null;
  return (
    <Stack
      gap="xs"
      // The mock's `.ac-banner` padding: 8px 10px.
      className="rounded-md border border-destructive/30 bg-destructive/10 px-smd py-sm"
    >
      <Text variant="caption">
        {active.name} hit its {USAGE_WINDOWS[reached.id].label.toLowerCase()}{" "}
        limit · {formatResets(reached.id, reached.resetsAt, now)}
      </Text>
      {next ? (
        <ForAudience audience="developer" mark="badge">
          <Line>
            <Fill />
            <Button onClick={() => onSwitch(next.id)}>
              Continue on {next.name}
              {next.kind === "api-key"
                ? " · API credit"
                : next.kind === "endpoint"
                  ? " · local model"
                  : room?.kind === "known"
                    ? ` · ${percent(room.left)} left`
                    : ""}
            </Button>
          </Line>
        </ForAudience>
      ) : null}
    </Stack>
  );
}

/** Where an API key's spend is claimed and keys are made. */
const PLAN_BILLING_URL = "https://claude.ai/settings/billing";
const CONSOLE_KEYS_URL = "https://platform.claude.com/settings/keys";

/** The steps that produce an API key, ending at its paste box. */
function ApiKeySteps({ input }: { input: ReactNode }) {
  return (
    <StepActions>
      <StepAction
        detail={<StepLink href={PLAN_BILLING_URL} label="Open billing" />}
      >
        On a Max or Team plan, claim its monthly API credit: link a Console
        organization under API credits
      </StepAction>
      <StepAction
        detail={<StepLink href={CONSOLE_KEYS_URL} label="Open API keys" />}
      >
        Create an API key in that organization
      </StepAction>
      <StepAction detail={input}>Paste the key</StepAction>
    </StepActions>
  );
}

const isApiKey = (key: string) =>
  API_KEY_PREFIXES.some((p) => key.startsWith(p));

/**
 * Add an API key: get one from the Console, then paste it with a name. The
 * only account added here — a plan is the computer's own Claude Code login
 * (`infra/claude-cli/accounts`).
 */
function AddApiKeyForm({
  onAdded,
  onCancel,
}: {
  onAdded: (id: string) => void;
  onCancel: () => void;
}) {
  const [credential, setCredential] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const fetchEndpoint = useFetchEndpoint();
  const key = credential.trim();
  const notAKey = key !== "" && !isApiKey(key);
  const add = async () => {
    setError(null);
    let added;
    try {
      added = await fetchEndpoint(
        addClaudeAccount,
        {},
        { body: { name: name.trim(), credential: key } },
      );
    } catch (err) {
      // A refused credential or name is the user's to fix: shown under the form.
      if (!(err instanceof EndpointError)) throw err;
      setError(getEndpointErrorMessage(err));
      return;
    }
    // The form renders only where the account endpoints are available.
    if (added.kind !== "ok") throw new Error(added.message);
    onAdded(added.value.id);
  };
  return (
    <Stack gap="sm" className="rounded-md border p-sm">
      <ApiKeySteps
        input={
          <Stack gap="xs">
            <Input
              autoFocus
              placeholder="Name — e.g. API credit"
              keep={transient(
                "a short label entered with the API key beside it, which is never kept",
              )}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <Input
              type="password"
              autoComplete="off"
              placeholder="sk-ant-…"
              keep={transient("secret: never written to browser storage")}
              value={credential}
              onChange={(e) => setCredential(e.target.value)}
              className="font-mono"
            />
          </Stack>
        }
      />
      {error || notAKey ? (
        <Text variant="caption" tone="destructive">
          {error ??
            `Not an API key (${API_KEY_PREFIXES.map((p) => `${p}…`).join(" / ")})`}
        </Text>
      ) : null}
      <Line className="gap-xs">
        <Fill />
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button disabled={!key || notAKey || !name.trim()} onClick={add}>
          Add API key
        </Button>
      </Line>
    </Stack>
  );
}

/** The API shapes an endpoint speaks, in picker wording. */
const ENDPOINT_API_ITEMS: Record<EndpointApi, string> = {
  openai: "OpenAI-compatible",
  anthropic: "Anthropic messages API",
};

/** The model mapping of the form's rows: only the filled-in tiers. */
function modelMapOf(maps: Record<ModelTier, string>): ModelMap | undefined {
  const map: ModelMap = {};
  for (const tier of MODEL_TIERS) {
    const name = maps[tier].trim();
    if (name !== "") map[tier] = name;
  }
  return Object.keys(map).length > 0 ? map : undefined;
}

/**
 * Add a local model endpoint: a model server the user runs (Ninfer, LM Studio,
 * Ollama, …) serves equin's agents and one-shot generations. `Test` runs one
 * turn on it without saving anything (a temporary account, deleted after);
 * `Add` runs the same test first and stores the account only when it passes —
 * its token, when it has one, going to the secrets store. The model mapping is
 * optional: an unmapped family runs as its own Claude flag, which a local
 * server that does not serve it rejects loudly.
 */
function AddEndpointForm({
  onAdded,
  onCancel,
}: {
  onAdded: (id: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [api, setApi] = useState<EndpointApi>("openai");
  const [token, setToken] = useState("");
  const [showMap, setShowMap] = useState(false);
  const [maps, setMaps] = useState<Record<ModelTier, string>>({
    haiku: "",
    sonnet: "",
    opus: "",
    fable: "",
  });
  const [busy, setBusy] = useState<null | "test" | "add">(null);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{
    reply: string;
    models?: string[];
  } | null>(null);
  const fetchEndpoint = useFetchEndpoint();

  const url = baseUrl.trim();
  // The server's own checks, mirrored for the button state and the note.
  const badUrl = url !== "" && !/^https?:\/\/\S+$/.test(url);
  const badMapping = MODEL_TIERS.some((tier) =>
    maps[tier].trim().startsWith("claude-"),
  );
  const invalid = name.trim() === "" || url === "" || badUrl || badMapping;
  const settings = { api, baseUrl: url, modelMap: modelMapOf(maps) };

  const test = async () => {
    setBusy("test");
    setError(null);
    setTestResult(null);
    try {
      const result = await fetchEndpoint(
        testClaudeEndpoint,
        {},
        {
          body: { endpoint: settings, token: token.trim() || undefined },
        },
      );
      if (result.kind !== "ok") throw new Error(result.message);
      setTestResult({
        reply: result.value.reply,
        models: result.value.models,
      });
    } catch (err) {
      // A refused connection, a model the server rejects: the endpoint's own
      // words, shown under the form.
      if (!(err instanceof EndpointError)) throw err;
      setError(getEndpointErrorMessage(err));
    } finally {
      setBusy(null);
    }
  };
  const add = async () => {
    setBusy("add");
    setError(null);
    try {
      const result = await fetchEndpoint(
        addClaudeEndpoint,
        {},
        {
          body: {
            name: name.trim(),
            endpoint: settings,
            token: token.trim() || undefined,
          },
        },
      );
      if (result.kind !== "ok") throw new Error(result.message);
      onAdded(result.value.id);
    } catch (err) {
      if (!(err instanceof EndpointError)) throw err;
      setError(getEndpointErrorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Stack gap="sm" className="rounded-md border p-sm">
      <Stack gap="xs">
        <Input
          autoFocus
          placeholder="Name — e.g. Ninfer"
          keep={transient(
            "a short label entered with the endpoint beside it, which is never kept",
          )}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Input
          placeholder="http://host:port/v1"
          keep={transient(
            "an endpoint URL entered with the form, which is never kept",
          )}
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          className="font-mono"
        />
        <Line className="gap-xs">
          <Select
            items={ENDPOINT_API_ITEMS}
            value={api}
            onValueChange={(v) => {
              if (v === null) return;
              if (ENDPOINT_APIS.includes(v as EndpointApi))
                setApi(v as EndpointApi);
            }}
          >
            <SelectTrigger aria-label="API kind" className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ENDPOINT_APIS.map((a) => (
                <SelectItem key={a} value={a}>
                  {ENDPOINT_API_ITEMS[a]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Fill />
          <Input
            type="password"
            autoComplete="off"
            placeholder="Token — leave empty if no auth"
            keep={transient("secret: never written to browser storage")}
            value={token}
            onChange={(e) => setToken(e.target.value)}
            className="font-mono"
          />
        </Line>
      </Stack>
      <Button
        variant="ghost"
        disabled={busy !== null}
        onClick={() => setShowMap(!showMap)}
      >
        {showMap ? "Hide the model mapping" : "Map the models (optional)"}
      </Button>
      {showMap ? (
        <Stack gap="xs">
          {MODEL_TIERS.map((tier) => (
            <Line key={tier} className="gap-xs">
              <Text variant="caption" tone="muted" className="w-14">
                {modelDisplayLabel(tier)}
              </Text>
              <Fill>
                <Input
                  placeholder="the server's model name"
                  keep={transient(
                    "a model name entered with the endpoint form, which is never kept",
                  )}
                  value={maps[tier]}
                  onChange={(e) => setMaps({ ...maps, [tier]: e.target.value })}
                  className="font-mono"
                />
              </Fill>
            </Line>
          ))}
          <Text variant="caption" tone="faint">
            Each family runs as its mapped model; an empty row runs as its
            Claude flag, which a server that does not serve it rejects.
          </Text>
        </Stack>
      ) : null}
      {testResult ? (
        <Stack gap="xsm" className="rounded-md border p-xsm">
          <Text variant="caption">Test reply: “{testResult.reply}”</Text>
          {testResult.models && testResult.models.length > 0 ? (
            <Text variant="caption" tone="muted" className="truncate">
              Models it offers: {testResult.models.join(", ")}
            </Text>
          ) : null}
        </Stack>
      ) : null}
      {error || badUrl || badMapping ? (
        <Text variant="caption" tone="destructive">
          {error ??
            (badUrl
              ? "The base URL must be an http:// or https:// URL"
              : "A mapped model is the server's own name — not a claude-… flag")}
        </Text>
      ) : null}
      <Line className="gap-xs">
        <Fill />
        <Button
          variant="outline"
          disabled={invalid || busy !== null}
          onClick={test}
        >
          {busy === "test" ? "Testing…" : "Test"}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button disabled={invalid || busy !== null} onClick={add}>
          {busy === "add" ? "Adding…" : "Add endpoint"}
        </Button>
      </Line>
    </Stack>
  );
}

/**
 * The account menu's body (the agent manager's sidebar foot): the active
 * account with its session and week meters (and the limit banner, the
 * conversations an API error stopped, with Resume all); then every account
 * with its weekly room, the active one filled — a click switches — and Add
 * account last; then the auto-resume switch. Its sections
 * are bands of the panel the foot opens (`ControlPanelPopover`), which draws
 * the rules between them.
 */
export function ClaudeAccountMenu({
  accounts,
  usage,
  claude,
  stopped,
  now,
}: {
  accounts: ClaudeAccounts;
  usage: ClaudeUsageRead;
  claude: ClaudeCodeStatus;
  stopped: readonly ErrorStoppedConversation[];
  now: number;
}) {
  const [adding, setAdding] = useState(false);
  const [addingEndpoint, setAddingEndpoint] = useState(false);
  // The account this tab switched to: running agents stay where they were.
  const [switchedTo, setSwitchedTo] = useState<string | null>(null);
  // The switch shows at once; what depends on it landing (the usage read of
  // the account switched to) runs on the server's answer (`switchTo`).
  const selectAccount = useEndpointMutation(selectClaudeAccount);
  const removeAccount = useEndpointMutation(removeClaudeAccount);
  const refreshUsage = useEndpointMutation(refreshClaudeUsage);
  // Accounts Claude Code reported no plan limits for, with why.
  const [unreadable, setUnreadable] = useState<Record<string, string>>({});
  const views = accountViews(accounts, claude);
  const active = activeAccountView(accounts, views);
  // One computer behind all three: the row's inputs, read off it, are
  // already ready, so this is the transport's own verdict.
  if (selectAccount.kind === "unavailable") {
    return (
      <ControlPanel.Section>
        <AccountHead account={active} usage={usage} now={now} />
        <StepNote>{selectAccount.message}</StepNote>
      </ControlPanel.Section>
    );
  }
  if (
    removeAccount.kind === "unavailable" ||
    refreshUsage.kind === "unavailable"
  )
    throw new Error("Claude accounts: endpoints disagree on the computer");
  // Its last reading is missing, or from before the switch: read it now.
  const readUsage = (accountId: string) =>
    refreshUsage.mutate(
      { body: { accountId } },
      {
        onSuccess: (result) =>
          setUnreadable(({ [accountId]: _, ...rest }) =>
            result.kind === "unavailable"
              ? { ...rest, [accountId]: result.reason }
              : rest,
          ),
      },
    );
  const usageRead = (accountId: string): UsageRead => {
    if (
      refreshUsage.isPending &&
      refreshUsage.variables.body.accountId === accountId
    )
      return { kind: "reading" };
    const reason = unreadable[accountId];
    return reason === undefined
      ? { kind: "idle" }
      : { kind: "unreadable", reason };
  };
  const switchTo = (id: string) =>
    selectAccount.mutate(
      { body: { id } },
      {
        onSuccess: () => {
          setSwitchedTo(id);
          // Only the computer's login has plan limits to read: an API key is
          // billed per use, a local endpoint runs on the user's own hardware.
          if (views.find((v) => v.id === id)?.kind === "login") readUsage(id);
        },
      },
    );
  return (
    // Every avatar in the menu is a `sm` solid disc: the panel's icon column
    // is an `sm` avatar wide (`cp-panel`), and the controls of the inline
    // forms and banners are the menu's compact size.
    <ControlSizeProvider size="sm">
      <ControlPanel.Section>
        <Stack gap="sm">
          <AccountHead account={active} usage={usage} now={now} />
          <LimitBanner
            views={views}
            active={active}
            usage={usage}
            now={now}
            onSwitch={switchTo}
          />
          <ErrorStoppedBanner
            stopped={stopped}
            accountId={active.id}
            accountName={active.name}
            usage={usage}
            now={now}
          />
        </Stack>
      </ControlPanel.Section>
      {/* `readout`: each row carries its weekly room (a bar over "51% left
          this week") beside its name and detail. */}
      <ControlPanel.Section label="Launch new agents on" needs="readout">
        {views.map((v) => (
          <ControlPanel.Row
            key={v.id}
            selected={v.id === active.id}
            onSelect={v.id === active.id ? undefined : () => switchTo(v.id)}
            icon={<Avatar fallbackGlyph={v.name} fallbackKey={v.id} />}
            detail={v.detail}
            trailing={
              <WeekRoomGlance
                account={v}
                usage={usage}
                read={usageRead(v.id)}
                now={now}
              />
            }
            // Every row carries the remove action, so every row's reading
            // ends at one edge: the computer's own sign-in shows it disabled,
            // saying why.
            actions={
              v.id === SYSTEM_ACCOUNT_ID ? (
                <IconButton
                  icon={removeIcon}
                  label="This computer's own sign-in can't be removed"
                  disabled
                />
              ) : (
                <IconButton
                  icon={removeIcon}
                  label={`Remove ${v.name}`}
                  onClick={() => removeAccount.mutate({ body: { id: v.id } })}
                />
              )
            }
          >
            {v.name}
          </ControlPanel.Row>
        ))}
        <ControlPanel.Row
          muted
          icon={<Avatar symbol={addIcon} colorless />}
          detail="Billed per use, no plan limits"
          onSelect={() => setAdding(!adding)}
        >
          Add an API key
        </ControlPanel.Row>
        {adding ? (
          <AddApiKeyForm
            onAdded={() => setAdding(false)}
            onCancel={() => setAdding(false)}
          />
        ) : null}
        <ControlPanel.Row
          muted
          icon={<Avatar symbol={addIcon} colorless />}
          detail="Your own model server — OpenAI-compatible or Anthropic"
          onSelect={() => setAddingEndpoint(!addingEndpoint)}
        >
          Add a local endpoint
        </ControlPanel.Row>
        {addingEndpoint ? (
          <AddEndpointForm
            onAdded={() => setAddingEndpoint(false)}
            onCancel={() => setAddingEndpoint(false)}
          />
        ) : null}
        {switchedTo === active.id ? (
          <StepNote>
            New agents launch on {active.name}. Agents already running keep
            their account until they restart.
          </StepNote>
        ) : null}
      </ControlPanel.Section>
      {/* Flush: the settings start on the panel's edge with the section
          text, not past the account rows' avatar column. */}
      <ControlPanel.Section flush>
        <AutoResumeSwitch />
      </ControlPanel.Section>
    </ControlSizeProvider>
  );
}

/**
 * Resume agents a usage limit stopped once it resets (this backend's agents:
 * the setting, like the agents, is the namespace's own).
 */
function AutoResumeSwitch() {
  const config = useConfigResult(autoResumeConfig);
  const set = useSetConfig(autoResumeConfig);
  switch (config.status) {
    case "loading":
      return <Loading variant="rows" />;
    case "error":
      return (
        <ResourceErrorInline
          variant="block"
          subject="the auto-resume setting"
          error={config.error}
          refetch={config.refetch}
        />
      );
    case "ready":
      break;
  }
  const { enabled } = config.data;
  return (
    <ControlPanel.Row
      select="switch"
      checked={enabled}
      muted
      wrap
      onSelect={() => set("enabled", !enabled)}
    >
      Resume stopped agents when their limit resets
    </ControlPanel.Row>
  );
}
