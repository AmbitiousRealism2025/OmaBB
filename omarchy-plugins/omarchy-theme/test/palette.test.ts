import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  contrastRatio,
  IncompleteThemeError,
  parseColorsToml,
  renderThemeCss,
} from "../palette.ts";

const fixture = (name: string) =>
  readFileSync(
    new URL(`./fixtures/${name}.colors.toml`, import.meta.url),
    "utf8",
  );

function declarations(css: string): Map<string, string> {
  return new Map(
    [...css.matchAll(/^\s*(--[a-z0-9-]+):\s*(.+);$/gm)].map((match) => [
      match[1] ?? "",
      match[2] ?? "",
    ]),
  );
}

describe("parseColorsToml", () => {
  it("reads quoted values and skips comments and blank lines", () => {
    const colors = parseColorsToml(
      [
        "# Yakiiro — Omarchy",
        'mode = "dark"',
        "",
        'accent = "#4A8AB0"   # temper blue',
        "background='#14131A'",
        "not a pair",
      ].join("\n"),
    );
    assert.deepEqual(colors, {
      mode: "dark",
      accent: "#4A8AB0",
      background: "#14131A",
    });
  });
});

describe("renderThemeCss", () => {
  it("maps a dark Omarchy theme onto bb's anchors and accents", () => {
    const { css, mode } = renderThemeCss(
      parseColorsToml(fixture("tokyo-night")),
      "Tokyo Night",
    );
    const tokens = declarations(css);
    assert.equal(mode, "dark");
    assert.equal(tokens.get("--canvas"), "#1a1b26");
    assert.equal(tokens.get("--ink"), "#a9b1d6");
    assert.equal(tokens.get("--primary"), "#7aa2f7");
    assert.equal(tokens.get("--destructive"), "#f7768e");
    assert.equal(tokens.get("--success"), "#9ece6a");
    assert.equal(tokens.get("--attention"), "#eb927b");
    assert.equal(tokens.get("--omarchy-theme-name"), '"Tokyo Night"');
  });

  it("follows Omarchy's terminal slots for the ANSI palette", () => {
    const tokens = declarations(
      renderThemeCss(parseColorsToml(fixture("tokyo-night")), "Tokyo Night")
        .css,
    );
    assert.equal(tokens.get("--ansi-0"), "#1a1b26");
    assert.equal(tokens.get("--ansi-7"), "#a9b1d6");
    assert.equal(tokens.get("--ansi-8"), "#414868");
    assert.equal(tokens.get("--ansi-11"), "#ff9e64");
    assert.equal(tokens.get("--ansi-15"), "#c0caf5");
    assert.equal(tokens.get("--ansi-bg-fg-0"), "#ffffff");
  });

  it("applies one palette in both of bb's light and dark modes", () => {
    const { css, mode } = renderThemeCss(
      parseColorsToml(fixture("catppuccin-latte")),
      "Catppuccin Latte",
    );
    assert.equal(mode, "light");
    assert.match(css, /^:root,\n\.light,\n\.dark \{$/m);
    assert.equal(declarations(css).get("--canvas"), "#eff1f5");
  });

  it("keeps text on the accent readable", () => {
    for (const name of ["tokyo-night", "catppuccin-latte"]) {
      const tokens = declarations(
        renderThemeCss(parseColorsToml(fixture(name)), name).css,
      );
      const primary = tokens.get("--primary") ?? "";
      const onPrimary = tokens.get("--primary-foreground") ?? "";
      assert.ok(
        contrastRatio(primary, onPrimary) >= 4.5,
        `${name}: ${onPrimary} on ${primary}`,
      );
    }
  });

  it("falls back to colorN keys", () => {
    const tokens = declarations(
      renderThemeCss(
        { color0: "#000000", color7: "#cccccc", color4: "#3366ff" },
        "Minimal",
      ).css,
    );
    assert.equal(tokens.get("--canvas"), "#000000");
    assert.equal(tokens.get("--ink"), "#cccccc");
    assert.equal(tokens.get("--primary"), "#3366ff");
  });

  it("rejects a theme without background and foreground", () => {
    assert.throws(
      () => renderThemeCss({ accent: "#ffffff" }, "Broken"),
      IncompleteThemeError,
    );
  });

  it("ignores values that are not #rrggbb colours", () => {
    const tokens = declarations(
      renderThemeCss(
        {
          background: "#101010",
          foreground: "#eeeeee",
          accent: "red; } body { display: none",
        },
        "Hostile",
      ).css,
    );
    assert.equal(tokens.get("--primary"), "#eeeeee");
  });

  it("quotes the theme name so it can't break out of the stylesheet", () => {
    const { css } = renderThemeCss(
      { background: "#101010", foreground: "#eeeeee" },
      'evil"; } body { display: none } </style>\n\\',
    );
    assert.equal(
      declarations(css).get("--omarchy-theme-name"),
      String.raw`"evil\"; } body { display: none } \3C /style> \\"`,
    );
    assert.ok(css.trimEnd().endsWith("}"));
  });

  it("keeps text on destructive and attention fills readable", () => {
    for (const name of ["tokyo-night", "catppuccin-latte"]) {
      const tokens = declarations(
        renderThemeCss(parseColorsToml(fixture(name)), name).css,
      );
      for (const fill of ["destructive", "attention"]) {
        const background = tokens.get(`--${fill}`) ?? "";
        const text = tokens.get(`--${fill}-foreground`) ?? "";
        assert.ok(
          contrastRatio(background, text) >= 4.5,
          `${name}: ${text} on ${background}`,
        );
      }
    }
  });
});
