import { describe, expect, it } from "vitest";

import { customerPayload, customerProblem } from "../customers/components/customer-fields";
import { roleKey } from "./components/role-edit-page";

describe("role internal names", () => {
  it("are lower-case words joined by underscores, starting with a letter", () => {
    expect(roleKey("Shift supervisor")).toBe("shift_supervisor");
    expect(roleKey("  Night-shift Cashier (2) ")).toBe("night_shift_cashier_2");
    expect(roleKey("2nd Manager")).toBe("nd_manager");
    expect(roleKey("Ñiño's helper")).toBe("nino_s_helper");
    expect(roleKey("!!!")).toBe("");
  });
});

describe("customer form rules", () => {
  it("needs a name, and an ID number for senior citizens and PWDs", () => {
    expect(customerProblem({ name: " " })).toBe("Enter the customer's name.");
    expect(customerProblem({ name: "Lola", type: "senior_citizen" })).toBe("Enter the senior citizen ID number.");
    expect(customerProblem({ name: "Ana", type: "pwd", id_number: "  " })).toBe("Enter the PWD ID number.");
    expect(customerProblem({ name: "Ana", type: "pwd", id_number: "PWD-1" })).toBeNull();
    expect(customerProblem({ name: "Rosa Store", type: "business" })).toBeNull();
  });

  it("sends cleared fields as null", () => {
    expect(customerPayload({ name: " Lola ", phone: "", is_active: true })).toEqual({ name: "Lola", phone: null, is_active: true });
  });
});
