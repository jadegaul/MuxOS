<div align="center">

<a href="https://MuxOS.app">
<img alt="MuxOS — a self-evolving, personal operating system for the agentic era" src="docs/readme/hero.svg" width="100%" />
</a>

<p>
<a href="https://MuxOS.app">MuxOS.app</a>
</p>

<p>
<a href="https://MuxOS.app/"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/readme/pill-film.svg" /><img alt="Watch the film" src="docs/readme/pill-film-light.svg" height="36" /></picture></a>
<a href="#-install"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/readme/pill-install.svg" /><img alt="Install" src="docs/readme/pill-install-light.svg" height="36" /></picture></a>
</p>

<a href="https://MuxOS.app/apps">
<picture><source media="(prefers-color-scheme: dark)" srcset="docs/readme/apps.svg" /><img alt="The apps MuxOS ships" src="docs/readme/apps-light.svg" width="100%" /></picture>
</a>

</div>

## ✦ What is MuxOS?

MuxOS is an agentic platform for building large apps at scale: hundreds of features,
maintained autonomously, built to last for years.
It adds [hundreds of improvements](https://MuxOS.app/foundations) on top of raw Claude:

- an **agent manager** designed to monitor dozens of sessions in parallel
- **background agents** that fix, push and update the app on their own
- a **plugin system** where every feature is a self-contained block that every app can reuse

## 🧠 Run your own model

MuxOS runs on your own model server as a first-class Claude account: any
OpenAI-compatible endpoint (Ninfer, Ollama, vLLM, LM Studio) or an Anthropic-native one.
A built-in translator proxy speaks Anthropic ⇄ OpenAI — requests and streaming, tool
calls and usage included — so every agent, one-shot generation and the usage ledger
work untouched. A model map (haiku / sonnet / opus → the server's own names) and the
model's real context window round it out, so auto-compaction fires before a smaller
local server refuses a turn.

## ◎ What people build with it

<table>
<tr>
<td width="50%" valign="top">

### Apps for a team or an organization

Production-grade apps that can be deployed standalone. Use the platform to develop the app from within. MuxOS provides the harness, agent-friendly primitives, an automated reporting system for bugs and performance issues, and [much more](https://MuxOS.app/foundations).

</td>
<td width="50%" valign="top">

### A personal operating system

The author's showcase: custom versions of every app they use daily, connected
to each other in one app:

* A custom agent manager
* A custom Notion
* A custom design tool
* A custom map app
* A custom piano learning app
* A custom file explorer
* ...

</td>
</tr>
</table>

## ⚡ Install

```bash
curl -fsSL https://raw.githubusercontent.com/jadegaul/MuxOS/main/install.sh | bash
```

Or prompt your agent:

```
Install MuxOS (https://github.com/jadegaul/MuxOS) on this Mac with its installer:
curl -fsSL https://raw.githubusercontent.com/jadegaul/MuxOS/main/install.sh | bash
If a step fails, fix it and run the installer again. When it is done, give me the link to the app.
```

Then open the address the installer prints — `http://muxos.localhost:<port>`, where the port is 8700 unless something else holds it (then the next free one up to 8709); `./muxos url` prints it again. And start your first wish.
