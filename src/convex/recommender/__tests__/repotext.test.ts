import { describe, expect, it } from "vitest";
import { buildRepoText, cleanReadme, textHash } from "../repotext";

describe("cleanReadme", () => {
  it("strips badge walls but keeps prose and screenshots", () => {
    const dirty = [
      "# cool-project",
      "",
      "[![CI](https://github.com/o/r/actions/workflows/ci.yml/badge.svg)](https://ci)",
      "![build](https://img.shields.io/badge/build-passing-green)",
      "<!-- comment to drop -->",
      "",
      "A terminal dashboard for homelabs.",
      "",
      "![screenshot](./docs/shot.png)",
    ].join("\n");
    const cleaned = cleanReadme(dirty);
    expect(cleaned).not.toContain("shields.io");
    expect(cleaned).not.toContain("badge.svg");
    expect(cleaned).not.toContain("comment to drop");
    expect(cleaned).toContain("A terminal dashboard for homelabs.");
    expect(cleaned).toContain("shot.png");
  });

  it("collapses blank walls and trims", () => {
    expect(cleanReadme("a\n\n\n\n\nb")).toBe("a\n\nb");
  });
});

describe("buildRepoText", () => {
  it("builds a labelled canonical text", () => {
    const text = buildRepoText({
      fullName: "burnt/sushi",
      description: "Fast CLI renderer",
      language: "Rust",
      topics: ["rust", "cli"],
      readme: "Renders tables fast.",
    });
    expect(text).toContain("Repository: burnt/sushi");
    expect(text).toContain("Description: Fast CLI renderer");
    expect(text).toContain("Language: Rust");
    expect(text).toContain("Topics: rust, cli");
    expect(text).toContain("Renders tables fast.");
  });

  it("survives missing optional fields and caps length", () => {
    const text = buildRepoText(
      { fullName: "o/r", topics: [], readme: "x".repeat(10_000) },
      500,
      200,
    );
    expect(text.length).toBeLessThanOrEqual(500);
    expect(text).toContain("Repository: o/r");
  });
});

describe("textHash", () => {
  it("is stable and sensitive to content", () => {
    expect(textHash("abc")).toBe(textHash("abc"));
    expect(textHash("abc")).not.toBe(textHash("abd"));
    expect(textHash("")).toHaveLength(8);
  });
});
