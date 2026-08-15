// End-to-end smoke test against a running dev server.
// Usage: BASE=http://localhost:3111 ADMIN_PASSWORD=devpass node scripts/smoke.mjs
import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://localhost:3111";
const PASSWORD = process.env.ADMIN_PASSWORD ?? "devpass";
const SHOT_DIR = process.env.SHOT_DIR ?? null;

function rk() {
  const c = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const g = () => Array.from({ length: 5 }, () => c[Math.floor(Math.random() * c.length)]).join("");
  return `${g()}-${g()}-${g()}`;
}
const KEYS = Array.from({ length: 6 }, rk);
const APP_NAME = `Smoke App ${Date.now()}`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on("pageerror", (e) => console.log("PAGE ERROR:", e.message));
page.on("console", (m) => m.type() === "error" && console.log("CONSOLE:", m.text()));

async function shot(name) {
  if (SHOT_DIR) await page.screenshot({ path: `${SHOT_DIR}/${name}.png`, fullPage: true });
}
const step = (s) => console.log(`\n▶ ${s}`);
function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
  console.log(`  ✓ ${msg}`);
}

const ADMIN_EMAIL = `admin+${Date.now()}@example.com`;
const ADMIN_PW = "correct-horse-battery";
const SETUP_CODE = process.env.SETUP_CODE ?? PASSWORD; // ADMIN_PASSWORD env of the server

step("first run: / → /login → /setup, create admin account");
await page.goto(`${BASE}/`);
await page.waitForURL(/\/(login|setup)/);
if (page.url().includes("/setup")) {
  await page.fill("#setupCode", "wrong-code");
  await page.fill("#name", "Test Admin");
  await page.fill("#email", ADMIN_EMAIL);
  await page.fill("#password", ADMIN_PW);
  await page.click("button[type=submit]");
  await page.waitForSelector("text=Setup code is wrong");
  assert(true, "wrong setup code rejected");
  await page.fill("#setupCode", SETUP_CODE);
  await page.fill("#password", ADMIN_PW); // password fields reset after a failed submit
  await page.click("button[type=submit]");
  await page.waitForURL(`${BASE}/`);
  assert(true, "admin created via setup and signed in");
  await page.click("button:has-text('Sign out')");
  await page.waitForURL(/\/login/);
} else {
  console.log("  (setup already done — using recovery sign-in to create a test admin)");
  await page.click("text=Locked out");
  await page.fill("#rpassword", SETUP_CODE);
  await page.click("button[type=submit]");
  await page.waitForURL(`${BASE}/`);
  await page.goto(`${BASE}/users`);
  await page.click("text=+ Invite user");
  await page.fill('form input[required]:not([type=email])', "Test Admin");
  await page.fill('form input[type=email]', ADMIN_EMAIL);
  await page.selectOption("form select", "admin");
  await page.click("button:has-text('Create invite')");
  await page.waitForSelector("text=Invite link for");
  const inv = await page.textContent(".font-mono.break-all");
  await page.click("button:has-text('Done')");
  await page.click("button:has-text('Sign out')");
  await page.goto(inv.trim());
  await page.fill("#password", ADMIN_PW); await page.fill("#password2", ADMIN_PW);
  await page.click("button[type=submit]"); await page.waitForURL(`${BASE}/`);
  await page.click("button:has-text('Sign out')");
  await page.waitForURL(/\/login/);
}

step("login: wrong password rejected");
await page.goto(`${BASE}/login`);
await page.fill("#email", ADMIN_EMAIL);
await page.fill("#password", "nope-nope-nope");
await page.click("button[type=submit]");
await page.waitForSelector("text=Wrong email or password");
assert(true, "wrong password shows error");

step("login: correct password");
await page.fill("#password", ADMIN_PW);
await page.click("button[type=submit]");
await page.waitForURL(`${BASE}/`);
await shot("01-dashboard");
assert(true, "logged in as admin");

step("recovery password sign-in works");
{
  const c = await browser.newContext(); const rp = await c.newPage();
  await rp.goto(`${BASE}/login`); await rp.click("text=Locked out");
  await rp.fill("#rpassword", SETUP_CODE); await rp.click("button[type=submit]");
  await rp.waitForURL(`${BASE}/`); assert(true, "recovery sign-in lands on dashboard");
  await c.close();
}

step("create app");
await page.goto(`${BASE}/apps/new`);
await page.fill('input[placeholder="e.g. 620"]', "620");
await page.click("text=Fetch from Steam");
const found = await page.waitForSelector("text=Found:", { timeout: 15000 }).then(() => true).catch(() => false);
console.log(found ? "  ✓ steam lookup filled name/artwork" : "  (steam lookup unavailable, using manual name)");
// Steam App IDs are unique per app; clear it so repeated test runs do not collide.
await page.fill('input[placeholder="e.g. 620"]', "");
await page.fill('input[placeholder="Game / DLC / package name"]', APP_NAME);
await page.click("text=Create app");
await page.waitForURL(/\/apps\/\d+$/);
const appUrl = page.url();
const appId = Number(appUrl.split("/").pop());
assert(appId > 0, `app created (#${appId})`);
await shot("02-app-empty");

step("import keys (paste, mixed formats, with dupes)");
await page.goto(`${BASE}/import?app=${appId}`);
const pasted = [
  KEYS[0],
  `Alice <alice@example.com>: ${KEYS[1]}`,
  `${KEYS[2]}, bob`,
  KEYS[2], // dupe within paste
  "this line has no key",
  KEYS[3].toLowerCase(),
  KEYS[4],
  KEYS[5],
].join("\n");
await page.fill("textarea", pasted);
await page.waitForSelector("text=all new", { timeout: 10000 });
await page.fill('input[placeholder="e.g. Beta testing wave 2"]', "Smoke batch");
await page.check("input[type=checkbox]"); // use context as note
await shot("03-import-preview");
await page.click("button:has-text('Import')");
await page.waitForSelector("text=Import complete");
const importText = await page.textContent(".card");
assert(importText.includes("6"), "6 new keys imported");
await shot("04-import-done");

step("re-import same keys → all skipped as duplicates");
await page.click("text=Import another");
await page.fill("textarea", KEYS.join("\n"));
await page.waitForSelector("text=already in vault");
assert(true, "dedup preview flags existing keys");
await page.click("button:has-text('Import')");
await page.waitForSelector("text=Import complete");
const t2 = await page.textContent(".card");
assert(/0<\/b>|>0</.test(await page.innerHTML(".card")) || t2.includes("0 new"), "0 new keys on re-import");
assert(t2.includes("6") && t2.includes("skipped"), "6 skipped as duplicates");

step("app page shows keys + counts");
await page.goto(appUrl);
await page.waitForSelector("table");
const rows = await page.$$("tbody tr");
assert(rows.length === 6, "6 rows in table");
await shot("05-app-keys");

step("reveal a key inline (admin)");
await page.click(`tbody tr:nth-child(1) td:nth-child(2) button`);
await page.waitForSelector(`text=${KEYS[0]}`);
assert(true, "key decrypted and shown");

step("bulk mark used");
page.once("dialog", (d) => d.accept("Charlie"));
await page.check("tbody tr:nth-child(5) input[type=checkbox]");
await page.check("tbody tr:nth-child(6) input[type=checkbox]");
await page.click("button:has-text('Mark used')");
await page.waitForSelector("text=Updated 2 key(s)");
await page.waitForTimeout(500);
const usedBadges = await page.$$("tbody .badge:has-text('Used')");
assert(usedBadges.length === 2, "2 keys marked used with assignee");

step("generate 2 claim links from pool");
await page.click("button:has-text('Generate links')");
await page.fill('input[type=number][min="1"][max]', "2");
await page.fill('input[placeholder="optional"]', "Dana");
await page.click("button:has-text('Create links')");
await page.waitForSelector("text=Links created");
const urls = await page.$$eval("td.break-all", (tds) => tds.map((t) => t.textContent.trim()));
assert(urls.length === 2 && urls.every((u) => u.includes("/claim/")), "2 claim URLs returned");
await shot("06-links-created");
await page.click("button:has-text('Done')");
await page.waitForTimeout(500);
await page.reload();
const reserved = await page.$$("tbody .badge:has-text('Reserved')");
assert(reserved.length === 2, "2 keys now reserved");

step("claim link: recipient flow in a fresh browser context");
const ctx2 = await browser.newContext();
const p2 = await ctx2.newPage();
await p2.goto(urls[0]);
await p2.waitForSelector("text=Reveal my key");
assert(!(await p2.content()).match(/[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}/), "key NOT in page before reveal (link-preview safe)");
if (SHOT_DIR) await p2.screenshot({ path: `${SHOT_DIR}/07-claim-ready.png` });
await p2.click("text=Reveal my key");
await p2.waitForSelector("text=Redeem on Steam");
const revealedKey = await p2.textContent(".select-all");
assert(KEYS.includes(revealedKey.trim()), `revealed key ${revealedKey.trim()} is one of ours`);
if (SHOT_DIR) await p2.screenshot({ path: `${SHOT_DIR}/08-claim-revealed.png` });

step("claim link: same browser can re-view within grace period");
await p2.reload();
await p2.waitForSelector("text=Redeem on Steam");
assert(true, "re-view works with grace cookie");

step("claim link: different browser sees already-claimed");
const ctx3 = await browser.newContext();
const p3 = await ctx3.newPage();
await p3.goto(urls[0]);
await p3.waitForSelector("text=already revealed");
assert(!(await p3.content()).includes(revealedKey.trim()), "key not leaked to second visitor");
if (SHOT_DIR) await p3.screenshot({ path: `${SHOT_DIR}/09-claim-already.png` });

step("claim link: bogus token → not found");
await p3.goto(`${BASE}/claim/${"x".repeat(32)}`);
await p3.waitForSelector("text=Link not found");
assert(true, "bogus token handled");

step("claim link: concurrent reveal race → exactly one winner");
const ctxA = await browser.newContext();
const ctxB = await browser.newContext();
const pa = await ctxA.newPage();
const pb = await ctxB.newPage();
await pa.goto(urls[1]);
await pb.goto(urls[1]);
await pa.waitForSelector("text=Reveal my key");
await pb.waitForSelector("text=Reveal my key");
await Promise.all([pa.click("text=Reveal my key"), pb.click("text=Reveal my key")]);
const done = (p) => p.locator("text=Redeem on Steam").or(p.locator("text=already revealed")).first().waitFor();
await Promise.all([done(pa), done(pb)]);
const aWon = (await pa.content()).includes("Redeem on Steam");
const bWon = (await pb.content()).includes("Redeem on Steam");
assert(aWon !== bWon, `exactly one of two racing visitors got the key (A=${aWon}, B=${bWon})`);

step("links page shows claimed links; app page shows claimed status");
await page.goto(`${BASE}/links?all=1`);
await page.waitForSelector("table");
const claimedCells = await page.$$("td:has-text('Claimed')");
assert(claimedCells.length >= 2, "links page lists claimed links");
await shot("10-links");
await page.goto(appUrl);
const claimed = await page.$$("tbody .badge:has-text('Claimed')");
assert(claimed.length === 2, "2 keys claimed on app page");

step("create link for a selected key, then revoke it → key back to available");
await page.check("tbody tr:nth-child(3) input[type=checkbox]"); // row 3 is still available
await page.click("button:has-text('Create links')");
await page.check("form input[type=checkbox]"); // no expiry
await page.click("form button:has-text('Create')");
await page.waitForSelector("text=Links created");
await page.click("button:has-text('Done')");
await page.goto(`${BASE}/links`);
await page.waitForSelector("text=Live · no expiry");
assert(true, "no-expiry link shows as 'no expiry'");
await page.goto(`${BASE}/links?view=expired`);
await page.waitForSelector("text=Expired, never opened");
assert(true, "expired-unopened view renders");
await page.goto(`${BASE}/links`);
page.once("dialog", (d) => d.accept());
await page.click("tbody button:has-text('Revoke')");
await page.waitForTimeout(800);
await page.goto(appUrl);
const avail = await page.$$("tbody .badge:has-text('Available')");
assert(avail.length === 2, "revoked link returned key to available (2 available)");

step("multi-key link: bundle 2 keys on one link, claim reveals both");
await page.goto(`${BASE}/import?app=${appId}`);
const BUNDLE = [rk(), rk()];
await page.fill("textarea", BUNDLE.join("\n"));
await page.waitForSelector("text=all new");
await page.click("button:has-text('Import')");
await page.waitForSelector("text=Import complete");
await page.goto(`${appUrl}?status=available`);
await page.waitForSelector("table");
await page.check("tbody tr:nth-last-child(1) input[type=checkbox]");
await page.check("tbody tr:nth-last-child(2) input[type=checkbox]");
await page.click("button:has-text('Create links')");
await page.check("input[type=radio] >> nth=1"); // one link with all keys
await page.click("form button:has-text('Create')");
await page.waitForSelector("text=Links created");
const bundleUrls = await page.$$eval("td.break-all", (t) => t.map((x) => x.textContent.trim()));
assert(bundleUrls.length === 1, "bundle produced exactly one link");
assert((await page.textContent("[role=dialog] tbody")).includes("2 keys"), "result row shows 2 keys");
await page.click("button:has-text('Done')");
{
  const c = await browser.newContext(); const bp = await c.newPage();
  await bp.goto(bundleUrls[0]);
  await bp.waitForSelector("text=Reveal my 2 keys");
  await bp.click("text=Reveal my 2 keys");
  await bp.waitForSelector("text=Copy all 2 keys");
  const shown = await bp.$$eval(".select-all", (els) => els.map((e) => e.textContent.trim()));
  assert(shown.length === 2 && BUNDLE.every((k) => shown.includes(k)), "both bundled keys revealed");
  await c.close();
}
await page.goto(`${BASE}/links?view=all`);
await page.waitForSelector("td:has-text('2 keys')");
assert(true, "links page shows the 2-key link");

step("tools: mark used by paste (one known, one unknown)");
await page.goto(`${BASE}/tools`);
const unknown = rk();
await page.fill("textarea", `${KEYS[0]}\n${unknown}`);
await page.click("button:has-text('Mark 2 as used')");
await page.waitForSelector("text=not found in the vault");
const toolText = await page.textContent(".card");
assert(toolText.includes("1") && toolText.includes(unknown), "1 marked used, unknown key reported back");
await shot("11-tools");

step("activity log has entries");
await page.goto(`${BASE}/activity`);
await page.waitForSelector("table");
const events = await page.$$("tbody tr");
assert(events.length > 10, `${events.length} audit events recorded`);
await shot("12-activity");


step("dev flow: top up the pool, invite a dev with limits 3/day, 2/batch");
await page.goto(`${BASE}/import?app=${appId}`);
await page.fill("textarea", Array.from({ length: 5 }, rk).join("\n"));
await page.waitForSelector("text=all new");
await page.click("button:has-text('Import')");
await page.waitForSelector("text=Import complete");
await page.goto(`${BASE}/users`);
await page.click("text=+ Invite user");
const DEV_EMAIL = `dev+${Date.now()}@example.com`;
await page.fill('form input[required]:not([type=email])', "Dev Dana");
await page.fill('form input[type=email]', DEV_EMAIL);
await page.fill('form input[type=number] >> nth=0', "3");
await page.fill('form input[type=number] >> nth=1', "2");
await page.click("button:has-text('Create invite')");
await page.waitForSelector("text=Invite link for Dev Dana");
const inviteUrl = (await page.textContent(".font-mono.break-all")).trim();
assert(inviteUrl.includes("/invite/"), "invite link produced");
await page.click("button:has-text('Done')");

const dctx = await browser.newContext(); const dp = await dctx.newPage();
dp.on("pageerror", (e) => console.log("DEV PAGE ERROR:", e.message));
await dp.goto(inviteUrl);
await dp.waitForSelector("text=Set a password");
await dp.fill("#password", "dev-password-123"); await dp.fill("#password2", "dev-password-123");
await dp.click("button[type=submit]");
await dp.waitForURL(`${BASE}/send`);
assert(true, "dev accepted invite and landed on /send");
await dp.goto(`${BASE}/`); await dp.waitForURL(`${BASE}/send`);
assert(true, "dev is bounced away from admin dashboard");
await dp.goto(`${BASE}/users`); await dp.waitForURL(`${BASE}/send`);
assert(true, "dev is bounced away from /users");
if (SHOT_DIR) await dp.screenshot({ path: `${SHOT_DIR}/13-dev-send.png`, fullPage: true });

step("dev: create 2 links (batch limit), then 1 more (daily=3), then denied");
await dp.click(`button:has-text('${APP_NAME}')`);
await dp.fill('input[type=number] >> nth=0', "2");
await dp.fill('input[placeholder="e.g. Sam (beta tester)"]', "Tester A");
await dp.click("button:has-text('Send 2 keys')");
await dp.waitForSelector("text=2 links for");
const devUrls = await dp.$$eval("td.break-all", (t) => t.map((x) => x.textContent.trim()));
assert(devUrls.length === 2, "dev got 2 links");
await dp.click("button:has-text('Done')");
await dp.waitForSelector("button:has-text('Send 1 key')");
await dp.waitForSelector("text=1 more keys today");
assert(true, "quota shows 1 remaining");
await dp.fill('input[type=number] >> nth=0', "1");
await dp.click("button:has-text('Send 1 key')");
await dp.waitForSelector("text=1 link for");
await dp.click("button:has-text('Done')");
await dp.waitForSelector("text=used today");
assert(await dp.isDisabled("button:has-text('Send')"), "create button disabled after daily quota");

step("dev: my links — revoke one, claim one, report bad key");
await dp.goto(`${BASE}/my-links`);
await dp.waitForSelector("table");
const devRows = await dp.$$("tbody tr");
assert(devRows.length === 3, "3 links listed");
dp.once("dialog", (d) => d.accept());
await dp.click("tbody tr >> nth=0 >> button:has-text('Revoke')");
await dp.waitForSelector("text=Revoked.");
const rc = await browser.newContext(); const rpg = await rc.newPage();
await rpg.goto(devUrls[1]); await rpg.click("text=Reveal my key"); await rpg.waitForSelector("text=Redeem on Steam");
await rc.close();
await dp.reload();
await dp.waitForSelector("text=Claimed");
dp.once("dialog", (d) => d.accept("did not activate"));
await dp.click("button:has-text('Report bad key')");
await dp.waitForSelector("text=Reported —");
await dp.reload();
await dp.waitForSelector("text=Reported bad");
assert(true, "dev revoked, recipient claimed, dev reported bad key");

step("admin sees creator + report; disable dev kills session; delete dev");
await page.goto(`${BASE}/links?all=1`);
await page.waitForSelector("td:has-text('Dev Dana')");
assert(true, "admin links page shows creator");
await page.goto(`${BASE}/activity`);
await page.waitForSelector("text=Key reported bad");
assert(true, "activity shows bad-key report");
await page.goto(appUrl);
const invalidBadges = await page.$$("tbody .badge:has-text('Invalid')");
assert(invalidBadges.length >= 1, "reported key marked invalid");
await page.goto(`${BASE}/users`);
await page.locator("tbody tr", { hasText: DEV_EMAIL }).locator("button:has-text('Disable')").click();
await page.waitForSelector("tbody tr:has-text('" + DEV_EMAIL + "') >> text=Disabled");
await dp.goto(`${BASE}/send`); await dp.waitForURL(/\/login/);
assert(true, "disabled dev is signed out immediately");
page.once("dialog", (d) => d.accept());
await page.locator("tbody tr", { hasText: DEV_EMAIL }).locator("button:has-text('Delete')").click();
await page.waitForTimeout(800);
await page.reload();
assert(!(await page.innerText("body")).includes(DEV_EMAIL), "dev deleted");
await dctx.close();

step("cleanup: delete app");
await page.goto(appUrl);
page.once("dialog", (d) => d.accept());
await page.click("button:has-text('Delete')");
await page.waitForURL(`${BASE}/`);
assert(!(await page.innerText("body")).includes(APP_NAME), "app deleted (not visible on dashboard)");

step("sign out");
await page.click("button:has-text('Sign out')");
await page.waitForURL(/\/login/);
assert(true, "logged out");

await browser.close();
console.log("\nALL SMOKE TESTS PASSED");
