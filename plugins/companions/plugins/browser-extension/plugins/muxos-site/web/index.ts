import type { PluginDefinition } from "@plugins/framework/plugins/web-sdk/core";
import { BrowserExtension } from "@plugins/companions/plugins/browser-extension/web";
import { openLocally, openOnPublicSite } from "./internal/actions";

export default {
  description:
    "The muxos site's page actions in the browser extension: on MuxOS.app, 'Open locally' (the same page on the local instance — the site's paths are the website app's, so it is an origin swap); on any local muxos page, 'Open on MuxOS.app' (a website page at the same path, any other page at the site's home). The mapping is the website's own (apps/website/shell core); this leaf only offers it, so the website's composition never carries the extension.",
  contributions: [
    BrowserExtension.PageAction(openLocally),
    BrowserExtension.PageAction(openOnPublicSite),
  ],
} satisfies PluginDefinition;
