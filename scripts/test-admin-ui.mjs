import assert from "node:assert/strict";
import { test } from "node:test";
import { adminRouteLabel, visibleAdminNavigation } from "../src/lib/admin/navigation.ts";

test("Admin navigation exposes only links backed by server-derived read grants", () => {
  assert.deepEqual(visibleAdminNavigation([]).map((item) => item.label), ["Dashboard"]);
  assert.deepEqual(visibleAdminNavigation(["catalog.read"]).map((item) => item.label),
    ["Dashboard", "Products", "Categories", "Collections", "Media"]);
  assert.deepEqual(visibleAdminNavigation(["catalog.import.receipt.read"]).map((item) => item.label),
    ["Dashboard", "Imports"]);
});

test("Product detail has a separate route label from its product family code", () => {
  assert.equal(adminRouteLabel("/admin/products/FAMILY-001"), "Product detail");
  assert.equal(adminRouteLabel("/admin/products"), "Products");
});
