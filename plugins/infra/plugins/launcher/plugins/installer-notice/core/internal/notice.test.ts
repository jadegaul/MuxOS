import { describe, expect, test } from "bun:test";
import {
  defineNotice,
  plainTextProblems,
  renderNotice,
  type InstallerNotice,
} from "./notice";

const good: InstallerNotice = {
  title: "macOS blocked muxos from adding its apps",
  doing:
    "muxos was adding an icon in your menu bar and its apps in their own windows.",
  blocked: "This Mac only lets apps you approved change other apps.",
  now: [
    "Turn on the app you ran the installer from in System Settings → Privacy & Security → App Management, then run `./muxos start` again.",
  ],
  ifSkipped: {
    optional: true,
    stillWorks:
      "muxos works fully in your browser at http://muxos.localhost:9000.",
    addLater: "Add them later with `./muxos start --only dev.muxos.menu-bar`.",
  },
  evidence: [
    "refused to write ~/Applications/muxos.app: Operation not permitted",
  ],
};

describe("installer notice", () => {
  test("a notice keeping every rule is accepted", () => {
    expect(defineNotice(good)).toBe(good);
  });

  test("internal names, paths and labels are refused outside commands and URLs", () => {
    expect(plainTextProblems("Installing the menu-bar helper")).toContain(
      'internal name "menu-bar helper"',
    );
    expect(plainTextProblems("the gateway did not start")).toContain(
      'internal name "gateway"',
    );
    expect(plainTextProblems("could not write ~/Applications/x")).toEqual([
      'path "~/Applications/x"',
    ]);
    expect(plainTextProblems("skipped dev.muxos.menu-bar")).toEqual([
      'label "dev.muxos.menu-bar"',
    ]);
    expect(
      plainTextProblems("run `./muxos start --only dev.muxos.gateway`"),
    ).toEqual([]);
  });

  test("defineNotice names each broken rule", () => {
    expect(() =>
      defineNotice({ ...good, blocked: "launchd refused\nEPERM", now: [] }),
    ).toThrow(/blocked: internal name "launchd"[\s\S]*now: no step/);
  });

  test("the evidence is rendered apart, under Details", () => {
    const text = renderNotice(good);
    const [message, details] = text.split("Details (for a bug report):");
    expect(message).not.toContain("Operation not permitted");
    expect(details).toContain("Operation not permitted");
    expect(message).toContain("It's optional:");
  });
});
