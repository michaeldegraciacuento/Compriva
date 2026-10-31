import { describe, expect, it } from "vitest";

import { splitMessage } from "./notify";

describe("pop-up messages", () => {
  it("keep a short title and move the rest of a sentence into the text", () => {
    expect(splitMessage("Customer saved", "Lola Carmen · C-0001")).toEqual({ title: "Customer saved", text: "Lola Carmen · C-0001" });
    expect(splitMessage("Juan Dela Cruz is suspended.")).toEqual({ title: "Juan Dela Cruz is suspended" });
    expect(splitMessage("New password set. Juan was signed out everywhere and must use it from now on."))
      .toEqual({ title: "New password set", text: "Juan was signed out everywhere and must use it from now on." });
    expect(splitMessage("PO-0003 received: stock added, ₱430.00 at cost.")).toEqual({ title: "PO-0003 received: stock added, ₱430.00 at cost" });
  });
});
