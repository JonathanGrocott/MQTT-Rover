import { describe, expect, it } from "vitest";
import { errorMessage } from "./errors";

describe("errorMessage", () => {
  it("returns string errors", () => {
    expect(errorMessage("boom")).toBe("boom");
  });

  it("returns Error messages", () => {
    expect(errorMessage(new Error("broken"))).toBe("broken");
  });

  it("extracts message field from objects", () => {
    expect(errorMessage({ message: "from-message" })).toBe("from-message");
  });

  it("extracts payload field from objects", () => {
    expect(errorMessage({ payload: "from-payload" })).toBe("from-payload");
  });

  it("returns fallback for unknown values", () => {
    expect(errorMessage(undefined, "fallback")).toBe("fallback");
  });
});
