import { chromium, type Browser } from 'playwright-core';
import { config } from '../../config';
import { HttpError } from '../../lib/http';

/**
 * Buka browser untuk UI Tester. `headless: false` membuka jendela sungguhan di
 * mesin tempat server berjalan (dipakai recorder & "run with browser visible").
 */
export async function launchBrowser(headless: boolean): Promise<Browser> {
  try {
    return await chromium.launch({
      headless,
      ...(config.browser.executablePath
        ? { executablePath: config.browser.executablePath }
        : { channel: config.browser.channel }),
      args: headless ? [] : ['--start-maximized'],
    });
  } catch (error) {
    const message = (error as Error).message.split('\n')[0];
    throw new HttpError(
      503,
      `Could not start the browser (${message}). Install Google Chrome, or set FLOWQA_BROWSER_PATH to a Chromium-based browser.`,
    );
  }
}
