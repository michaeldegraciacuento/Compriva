import { describe, expect, it } from "vitest";

import { parseEnv } from "./env";

describe("parseEnv", () => {
  it("strips trailing slashes and applies defaults", () => {
    expect(parseEnv({ NEXT_PUBLIC_API_URL: "https://api.compriva.test/" })).toEqual({
      NEXT_PUBLIC_API_URL: "https://api.compriva.test",
      NEXT_PUBLIC_APP_ENV: "local",
    });
  });

  it("fails loudly when the API URL is missing or invalid", () => {
    expect(() => parseEnv({})).toThrow(/NEXT_PUBLIC_API_URL/);
    expect(() => parseEnv({ NEXT_PUBLIC_API_URL: "not a url" })).toThrow(/Invalid environment/);
  });
});
