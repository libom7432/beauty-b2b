import assert from "node:assert/strict";
import { test } from "node:test";
import { adminRouteLabel, isAdminCollectionDetailPath, visibleAdminNavigation } from "../src/lib/admin/navigation.ts";

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

test("Collections detail has its own label without changing list or category labels", () => {
  const valid = "/admin/collections/550e8400-e29b-41d4-a716-446655440000";
  assert.equal(isAdminCollectionDetailPath(valid), true);
  assert.equal(adminRouteLabel(valid), "Collection detail");
  for (const path of [
    "/admin/collections",
    "/admin/collections/",
    "/admin/collections/invalid",
    `${valid}/`,
    `${valid}/extra`,
    "/admin/collections//550e8400-e29b-41d4-a716-446655440000",
    `${valid}?x=1`,
    `${valid}#detail`,
    "/admin/products/550e8400-e29b-41d4-a716-446655440000",
  ]) {
    assert.equal(isAdminCollectionDetailPath(path), false, path);
    assert.notEqual(adminRouteLabel(path), "Collection detail", path);
  }
  assert.equal(adminRouteLabel("/admin/collections"), "Collections");
  assert.equal(adminRouteLabel("/admin/categories"), "Categories");
  assert.equal(adminRouteLabel("/admin/media"), "Media");
});
