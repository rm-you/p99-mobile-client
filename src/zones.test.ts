import { expect, it } from "vitest";
import { zoneName } from "./zones";

it("expands zone identifiers across eras and leaves unknown values intact", () => {
  expect(zoneName("ecommons")).toBe("East Commonlands");
  expect(zoneName("eastcommons")).toBe("East Commonlands");
  expect(zoneName("CHARASIS")).toBe("Howling Stones");
  expect(zoneName("velketor")).toBe("Velketor's Labyrinth");
  expect(zoneName("future_zone")).toBe("future_zone");
  expect(zoneName("constructor")).toBe("constructor");
});
