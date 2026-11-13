import { readFile } from "node:fs/promises";
import { test, expect, type Page } from "@playwright/test";

const CODE_APP = `http://127.0.0.1:${Number(process.env.E2E_PORT ?? 3100) + 1}`;
const newKey = () => `tcg_test_${Date.now()}_${Math.random().toString(36).slice(2)}`; // the mock keeps one scan count per key
const total = (page: Page) => page.getByRole("status");
const start = (page: Page) => page.getByRole("button", { name: "Start scanning" });
const shutter = (page: Page) => page.getByRole("button", { name: "Scan card" });

async function open(page: Page, key: string) {
  await page.goto("/");
  await page.getByLabel("Your TCG API key").fill(key);
  await start(page).click();
}

test("a collector scans a stack with the camera, corrects it and exports it", async ({ page }) => {
  await test.step("open the scanner with my API key", () => open(page, newKey()));
  await expect(shutter(page)).toBeVisible();
  await expect(total(page)).toHaveText("0 cards · $0.00");

  await test.step("scan a card the API matches", () => shutter(page).click());
  await expect(page.getByRole("heading", { name: "Darkrai" })).toBeVisible();
  await expect(total(page)).toHaveText("1 card · $1.49 · 24 scans left");

  await test.step("scan a card with two versions and pick mine", async () => {
    await shutter(page).click();
    await expect(page.getByText("Several versions fit")).toBeVisible();
    await page.getByRole("button", { name: "Charizard Base Set 2 · 4/130" }).click();
  });
  await expect(total(page)).toHaveText("2 cards · $122.24 · 23 scans left");

  await test.step("scan a photo the API cannot read", () => shutter(page).click());
  await expect(page.getByText("The collector number is cut off.")).toBeVisible();
  await expect(total(page)).toHaveText("2 cards · $122.24 · 22 scans left");

  await test.step("make Darkrai two reverse holos", async () => {
    await page.getByLabel("Printing of Darkrai").selectOption("Reverse Holofoil");
    await page.getByLabel("Quantity of Darkrai").fill("2");
  });
  await expect(total(page)).toHaveText("3 cards · $123.57 · 22 scans left");

  const download = await test.step("export the list", async () => {
    const waiting = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export CSV" }).click();
    return waiting;
  });
  expect(download.suggestedFilename()).toBe("scanned-cards.csv");
  expect(await readFile(await download.path(), "utf8")).toBe(
    [
      '"Quantity","Name","Set","Number","Printing","Game","TCGplayer ID","Card ID","Market price"',
      '"1","Charizard","Base Set 2","4/130","Holofoil","Pokemon","1007","1002","120.75"',
      '"2","Darkrai","SM - Burning Shadows","87/147","Reverse Holofoil","Pokemon","138577","24535","1.41"',
    ].join("\r\n"),
  );

  await test.step("come back to the list later", () => page.reload());
  await expect(total(page)).toHaveText("3 cards · $123.57");
  await expect(page.getByText("The collector number is cut off.")).toBeVisible();

  await test.step("clear the list", async () => {
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Clear list" }).click();
  });
  await expect(total(page)).toHaveText("0 cards · $0.00");
  await expect(page.getByRole("listitem")).toHaveCount(0);
});

test("photos from the gallery are read like camera shots", async ({ page }) => {
  await open(page, newKey());
  await test.step("add a saved photo", () =>
    page.getByLabel("Add photos").setInputFiles({
      name: "card.png", // the mock API only accepts JPEG, so this also proves the photo is converted
      mimeType: "image/png",
      buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64"),
    }));
  await expect(page.getByRole("heading", { name: "Darkrai" })).toBeVisible();
  await expect(total(page)).toHaveText("1 card · $1.49 · 24 scans left");
});

test("a wrong API key is refused, and the photo is read once the key is right", async ({ page }) => {
  await test.step("scan with a key the API rejects", async () => {
    await open(page, "not-a-key");
    await shutter(page).click();
  });
  await expect(page.getByText("Invalid API key.")).toBeVisible();

  await test.step("enter a working key and try the photo again", async () => {
    await page.getByLabel("Your TCG API key").fill(newKey());
    await start(page).click();
    await page.getByRole("button", { name: "Try again" }).click();
  });
  await expect(total(page)).toHaveText("1 card · $1.49 · 24 scans left");
});

test("an access code keeps strangers from spending the server's scans", async ({ page }) => {
  await test.step("try a wrong code", async () => {
    await page.goto(CODE_APP);
    await page.getByLabel("Access code").fill("guess");
    await start(page).click();
    await shutter(page).click();
  });
  await expect(page.getByText("Wrong access code.")).toBeVisible();

  await test.step("enter the right code and try the photo again", async () => {
    await page.getByLabel("Access code").fill("open-sesame");
    await start(page).click();
    await page.getByRole("button", { name: "Try again" }).click();
  });
  await expect(page.getByRole("heading", { name: "Darkrai" })).toBeVisible();
});
