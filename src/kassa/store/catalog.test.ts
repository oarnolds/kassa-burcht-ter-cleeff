import { beforeEach, expect, it } from "vitest";
import { catalog, deleteKassaDatabase } from "../../test-utils";
import { loadCatalog, noteSold, saveCatalog, soldSinceFetch } from "./catalog";
import { getMeta, setMeta } from "./db";

beforeEach(deleteKassaDatabase);

it("has no catalog before the first fetch", async () => {
  expect(await loadCatalog()).toBeNull();
  expect(await soldSinceFetch()).toEqual({});
});

it("keeps the catalog and counts what was sold since it was fetched", async () => {
  await saveCatalog(catalog);
  expect(await loadCatalog()).toEqual(catalog);
  await noteSold([{ productId: "aardbeitje", qty: 2 }]);
  await noteSold([{ productId: "aardbeitje", qty: 1 }]);
  expect(await soldSinceFetch()).toEqual({ aardbeitje: 3 });
  await saveCatalog(catalog);
  expect(await soldSinceFetch()).toEqual({});
});

it("takes a reversal off again", async () => {
  await noteSold([
    { productId: "aardbeitje", qty: 2 },
    { productId: "koffie", qty: 1 },
  ]);
  await noteSold([{ productId: "koffie", qty: -1 }]);
  expect(await soldSinceFetch()).toEqual({ aardbeitje: 2 });
});

it("does not lose a count when two sales are noted at the same moment", async () => {
  await Promise.all([noteSold([{ productId: "aardbeitje", qty: 1 }]), noteSold([{ productId: "aardbeitje", qty: 1 }])]);
  expect(await soldSinceFetch()).toEqual({ aardbeitje: 2 });
});

it("stores other values by key", async () => {
  expect(await getMeta("deviceToken")).toBeUndefined();
  await setMeta("deviceToken", "tok");
  expect(await getMeta<string>("deviceToken")).toBe("tok");
});
