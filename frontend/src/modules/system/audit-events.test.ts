import { describe, expect, it } from "vitest";

import { changes, eventLabel, formatValue, subjectHref } from "./audit-events";

describe("audit log display", () => {
  it("names known events and makes unknown ones readable", () => {
    expect(eventLabel("sale.voided")).toBe("Sale voided");
    expect(eventLabel("product_image.added")).toBe("Product image added");
  });

  it("links subjects that have a page", () => {
    expect(subjectHref("sale", "s1")).toBe("/sales/view?id=s1");
    expect(subjectHref("role", "r1")).toBe("/roles/edit?id=r1");
    expect(subjectHref("setting", "x")).toBeNull();
  });

  it("shows values and old → new changes field by field", () => {
    expect(formatValue(true)).toBe("Yes");
    expect(formatValue(null)).toBe("—");
    expect(formatValue([])).toBe("(none)");
    expect(formatValue(["Open 7am", "QC"])).toBe("Open 7am, QC");
    expect(changes({ old_values: { group: "receipt", footer_text: "Thanks" }, new_values: { group: "receipt", footer_text: "Salamat", show_vat_breakdown: false } }))
      .toEqual([
        { key: "group", label: "Group", old: "receipt", new: "receipt" },
        { key: "footer_text", label: "Receipt footer", old: "Thanks", new: "Salamat" },
        { key: "show_vat_breakdown", label: "VAT breakdown", old: undefined, new: false },
      ]);
  });
});
