import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Barbell } from "./Barbell";

describe("Barbell", () => {
  it("labels progress and draws symmetric filled and dashed target slots", () => {
    const markup = renderToStaticMarkup(
      <Barbell count={2} target={4} size="big" />,
    );

    expect(markup).toContain('aria-label="2 of 4 workouts"');
    expect(markup.match(/fill="var\(--chalk\)"/g)).toHaveLength(4);
    expect(markup.match(/stroke-dasharray="4 4"/g)).toHaveLength(4);
  });

  it("narrows high-target plates and contains over-target progress", () => {
    const markup = renderToStaticMarkup(
      <Barbell count={7} target={6} size="big" />,
    );
    const plateWidths = [...markup.matchAll(/width="([\d.]+)"[^>]+rx="3"/g)]
      .map((match) => Number(match[1]))
      .filter((width) => width < 30);
    const plateXs = [
      ...markup.matchAll(/<rect x="([\d.]+)"[^>]+fill="var\(--chalk\)"/g),
    ].map((match) => Number(match[1]));

    expect(markup).toContain('aria-label="7 of 6 workouts"');
    expect(Math.max(...plateWidths)).toBeLessThan(20);
    expect(Math.min(...plateXs)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...plateXs) + Math.max(...plateWidths)).toBeLessThanOrEqual(
      350,
    );
  });

  it("draws mini bars with their own accessible progress", () => {
    const markup = renderToStaticMarkup(
      <Barbell count={3} target={5} size="mini" />,
    );

    expect(markup).toContain('class="barbell barbell-mini"');
    expect(markup).toContain('aria-label="3 of 5 workouts"');
    expect(markup.match(/stroke-dasharray="3 3"/g)).toHaveLength(4);
  });
});
