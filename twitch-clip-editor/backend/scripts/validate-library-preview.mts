/**
 * Validate library card audio/video preview in browser.
 * Requires frontend :3000 and backend :3001 running.
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";

async function waitForGrid(page: import("playwright").Page) {
  await page.goto(`${BASE}/biblioteca`, { waitUntil: "domcontentloaded" });
  const t0 = performance.now();
  await page.getByTestId("library-count").waitFor({ timeout: 15000 });
  const ms = Math.round(performance.now() - t0);
  const countText = await page.getByTestId("library-count").textContent();
  return { ms, countText };
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const results: Record<string, string> = {};

  const grid = await waitForGrid(page);
  results["first_render_ms"] = String(grid.ms);
  results["count_label"] = grid.countText ?? "";

  // Filter SFX
  await page.getByRole("button", { name: "Efeito sonoro", exact: true }).click();
  await page.waitForTimeout(400);

  const playButtons = page.locator('[data-testid^="library-play-"]');
  const playCount = await playButtons.count();
  if (playCount < 2) {
    results["audio_a"] = "SKIP: fewer than 2 sfx cards";
  } else {
    const first = playButtons.nth(0);
    const second = playButtons.nth(1);
    const id1 = (await first.getAttribute("data-testid"))!.replace("library-play-", "");

    await first.click();
    await page.waitForTimeout(300);
    const playing1 = await page.evaluate(() => {
      const a = document.querySelector("audio") as HTMLAudioElement | null;
      return a ? !a.paused : false;
    });
    results["audio_a"] = playing1 ? "PASS: first plays" : "FAIL: no audio element playing";

    await second.click();
    await page.waitForTimeout(300);
    const onlyOne = await page.evaluate((prevId) => {
      const audios = Array.from(document.querySelectorAll("audio")) as HTMLAudioElement[];
      const playing = audios.filter((a) => !a.paused);
      return playing.length <= 1;
    }, id1);
    results["audio_b"] = onlyOne ? "PASS: second stops first" : "FAIL: multiple playing";

    await first.click();
    await page.waitForTimeout(200);
    const stopped = await page.evaluate(() => {
      const audios = Array.from(document.querySelectorAll("audio")) as HTMLAudioElement[];
      return audios.every((a) => a.paused);
    });
    results["audio_c"] = stopped ? "PASS: toggle stops" : "FAIL: still playing after second click";
  }

  // Video hover on biblioteca page
  await page.getByRole("button", { name: "Vídeo", exact: true }).click();
  await page.waitForTimeout(400);
  const videoCard = page.locator('[data-item-type="video"]').first();
  if ((await videoCard.count()) === 0) {
    results["video_biblioteca"] = "SKIP: no video cards";
  } else {
    const cardId = await videoCard.getAttribute("data-testid");
    const media = videoCard.locator(`[data-testid="library-card-media-${cardId?.replace("library-card-", "")}"]`);
    await media.hover();
    await page.waitForTimeout(400);
    const hasVideo = await videoCard.locator("video").count();
    const thumbVisible = await videoCard.locator('[data-testid^="library-thumb-"]').isVisible().catch(() => false);
    results["video_hover_play"] = hasVideo > 0 ? "PASS: video element shown" : "FAIL";
    await page.mouse.move(0, 0);
    await page.waitForTimeout(300);
    const thumbAfter = await videoCard.locator('[data-testid^="library-thumb-"]').isVisible().catch(() => false);
    results["video_hover_thumb"] = thumbAfter ? "PASS: thumb returns" : "FAIL or no thumb cached";
  }

  // Editor panel narrow - find a marked candidate URL from API
  const libRes = await fetch("http://localhost:3001/effects-library/browse?type=video&limit=1");
  const lib = (await libRes.json()) as { items: Array<{ id: string }> };
  const candRes = await fetch("http://localhost:3001/vods");
  const vods = (await candRes.json()) as { vods: Array<{ vodId: string }> };
  let editorOk = "SKIP: no candidate route found";
  if (vods.vods?.length) {
    const vodId = vods.vods[0].vodId;
    const marked = await fetch(`http://localhost:3001/vod/${vodId}/marked-candidates`);
    const markedData = (await marked.json()) as {
      candidates: Array<{ id: string }>;
    };
    const cid = markedData.candidates?.[0]?.id;
    if (cid) {
      await page.goto(`${BASE}/vod/${vodId}/marked/${cid}`, {
        waitUntil: "domcontentloaded",
      });
      await page.getByRole("button", { name: /efeitos/i }).click().catch(() => undefined);
      await page.waitForTimeout(800);
      const panelBrowser = page.getByTestId("library-browser");
      if (await panelBrowser.isVisible()) {
        const sfxBtn = panelBrowser.getByRole("button", { name: "Efeito sonoro", exact: true });
        if (await sfxBtn.isVisible()) await sfxBtn.click();
        const panelPlay = panelBrowser.locator('[data-testid^="library-play-"]').first();
        if (await panelPlay.count()) {
          await panelPlay.click();
          await page.waitForTimeout(250);
          const playing = await page.evaluate(() => {
            const a = document.querySelector("audio") as HTMLAudioElement | null;
            return a ? !a.paused : false;
          });
          editorOk = playing ? "PASS: panel audio preview" : "FAIL: panel audio";
        } else {
          editorOk = "SKIP: no audio in panel";
        }
      } else {
        editorOk = "SKIP: library browser not visible in efeitos tab";
      }
    }
  }
  results["panel_narrow"] = editorOk;

  console.log(JSON.stringify(results, null, 2));
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
