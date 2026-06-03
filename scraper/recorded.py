import re
from playwright.sync_api import Playwright, sync_playwright, expect


def run(playwright: Playwright) -> None:
    browser = playwright.chromium.launch(channel="chrome", headless=False)
    context = browser.new_context(locale="python-async")
    page.goto("https://www.xiaohongshu.com/search_result/?keyword=%E5%9C%9F%E6%9C%A8&type=51&sort=time_descending")
    page.close()

    # ---------------------
    context.close()
    browser.close()


with sync_playwright() as playwright:
    run(playwright)
