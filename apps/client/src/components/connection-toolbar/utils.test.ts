import { describe, expect, it } from "vitest";
import {
  parseUserProperties,
  serializeUserProperties,
  toNumber,
  toOperationErrorMessage,
  toOptionalNumber
} from "./utils";

describe("connection toolbar utils", () => {
  it("parses and serializes user properties", () => {
    const parsed = parseUserProperties("a=1\n  b = two \ninvalid");
    expect(parsed).toEqual([
      { key: "a", value: "1" },
      { key: "b", value: "two" }
    ]);
    expect(serializeUserProperties(parsed)).toBe("a=1\nb=two");
  });

  it("returns undefined when no valid user properties exist", () => {
    expect(parseUserProperties("\nfoo\n=")).toBeUndefined();
  });

  it("handles numeric helpers", () => {
    expect(toNumber("42", 1)).toBe(42);
    expect(toNumber("x", 1)).toBe(1);
    expect(toOptionalNumber(" 99 ")).toBe(99);
    expect(toOptionalNumber(" ")).toBeUndefined();
  });

  it("formats operation errors", () => {
    expect(toOperationErrorMessage("bad request")).toBe("bad request");
    expect(toOperationErrorMessage(new Error("boom"))).toBe("boom");
    expect(toOperationErrorMessage({})).toBe("Operation failed");
  });
});
