import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Delta, StatCard } from "./stat-card";

afterEach(cleanup);

function deltaBadge(container: HTMLElement) {
  return container.querySelector("[data-direction]") as HTMLElement;
}

describe("StatCard", () => {
  it("shows label, value and optional meta", () => {
    render(<StatCard label="Gross profit" value="₱11,816.37" meta="20.0% margin" />);

    expect(screen.getByText("Gross profit")).toBeTruthy();
    expect(screen.getByTestId("stat-value").textContent).toBe("₱11,816.37");
    expect(screen.getByText("20.0% margin")).toBeTruthy();
  });
});

describe("Delta (direction × whether up is good)", () => {
  it("an increase that is good reads as success, with a sign and an arrow", () => {
    const { container } = render(<Delta percent="4.62" comparedTo="vs yesterday" />);

    expect(deltaBadge(container).dataset.direction).toBe("up");
    expect(deltaBadge(container).className).toContain("text-success");
    expect(deltaBadge(container).textContent).toBe("+4.6%");
    expect(deltaBadge(container).querySelector("svg")).toBeTruthy();
  });

  it("a decrease of something good reads as danger", () => {
    const { container } = render(<Delta percent="-3" comparedTo="vs yesterday" />);

    expect(deltaBadge(container).className).toContain("text-danger");
    expect(deltaBadge(container).textContent).toBe("−3.0%");
  });

  it("an increase of something bad (e.g. refunds) reads as danger", () => {
    const { container } = render(<Delta percent="10" comparedTo="vs last week" upIsGood={false} />);

    expect(deltaBadge(container).className).toContain("text-danger");
  });

  it("no change is neutral", () => {
    const { container } = render(<Delta percent="0" comparedTo="vs yesterday" />);

    expect(deltaBadge(container).dataset.direction).toBe("flat");
    expect(deltaBadge(container).className).toContain("text-muted-foreground");
  });
});
