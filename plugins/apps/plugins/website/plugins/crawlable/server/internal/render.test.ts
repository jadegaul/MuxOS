import { describe, expect, test } from "bun:test";
import { defineWebsitePage } from "../../core";
import { renderRobotsTxt, renderSitemapXml, requestOrigin } from "./render";

const req = (headers: Record<string, string>) =>
  new Request("http://backend/robots.txt", { headers });

describe("requestOrigin", () => {
  test("the Host header, over http when nothing says otherwise", () => {
    expect(requestOrigin(req({ host: "website.localhost:9000" }))).toBe(
      "http://website.localhost:9000",
    );
  });

  test("the scheme X-Forwarded-Proto reports (first hop of a chain)", () => {
    expect(
      requestOrigin(req({ host: "MuxOS.app", "x-forwarded-proto": "https" })),
    ).toBe("https://MuxOS.app");
    expect(
      requestOrigin(
        req({ host: "MuxOS.app", "x-forwarded-proto": "HTTPS, http" }),
      ),
    ).toBe("https://MuxOS.app");
  });

  test("the visitor's host from X-Forwarded-Host wins over the proxied Host", () => {
    expect(
      requestOrigin(
        req({
          host: "backend",
          "x-forwarded-host": "MuxOS.app",
          "x-forwarded-proto": "https",
        }),
      ),
    ).toBe("https://MuxOS.app");
  });

  test("an empty X-Forwarded-Host falls back to Host", () => {
    expect(
      requestOrigin(
        req({ host: "website.localhost:9000", "x-forwarded-host": "" }),
      ),
    ).toBe("http://website.localhost:9000");
  });

  test("an unknown scheme falls back to http", () => {
    expect(
      requestOrigin(req({ host: "MuxOS.app", "x-forwarded-proto": "ftp" })),
    ).toBe("http://MuxOS.app");
  });

  test("throws with neither header", () => {
    // `new Request` adds no Host of its own.
    expect(() => requestOrigin(req({}))).toThrow(/no X-Forwarded-Host or Host/);
  });
});

describe("renderRobotsTxt", () => {
  test("allows everything and points at the sitemap", () => {
    expect(renderRobotsTxt("https://MuxOS.app")).toBe(
      "User-agent: *\nAllow: /\nSitemap: https://MuxOS.app/sitemap.xml\n",
    );
  });
});

describe("renderSitemapXml", () => {
  const page = (path: string) =>
    defineWebsitePage({ path, title: "T", description: "D." });

  test("one <url><loc> per page, sorted by path", () => {
    expect(
      renderSitemapXml(
        "https://MuxOS.app",
        [page("/about/download"), page("/about")],
        null,
      ),
    ).toBe(
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
        `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
        `  <url><loc>https://MuxOS.app/about</loc></url>\n` +
        `  <url><loc>https://MuxOS.app/about/download</loc></url>\n` +
        `</urlset>\n`,
    );
  });

  test("escapes the origin", () => {
    expect(renderSitemapXml("http://a&b", [page("/about")], null)).toContain(
      "<loc>http://a&amp;b/about</loc>",
    );
  });

  test("lists each page at its address under an address root", () => {
    const xml = renderSitemapXml(
      "https://MuxOS.app",
      [page("/about/vision"), page("/about")],
      "/about",
    );
    expect(xml).toContain("<loc>https://MuxOS.app/</loc>");
    expect(xml).toContain("<loc>https://MuxOS.app/vision</loc>");
    expect(xml).not.toContain("/about");
  });
});
