#!/usr/bin/env python3
"""
Creator Hub — Whop Auto-Submission Worker (Multi-User, Multi-VPS)
================================================================
Ported from whop-submission/main.py with full multi-account & VPS awareness.

Features:
- Polls Creator Hub for pending Whop submissions assigned to this VPS's users (FIFO / oldest first).
- Supports multiple Whop accounts (switching browser context & session cookies per whop_email).
- Smart Session Continuity (Fast-Resume):
  - IF (same whop_email AND same campaign) -> Skip navigation/Discover/search, submit clip in-place!
  - IF (same whop_email AND different campaign) -> Keep context, navigate to campaign channel link -> Discover -> Campaign.
  - IF (different whop_email OR first run) -> Full scratch start: switch context with new email's cookies -> channel link -> Discover -> Campaign.
- Humanized delays, synthetic mouse dispatch, iframe resolution, live validation checks, and automatic dismissal of "Done" confirmations.
"""

import os
import sys
import time
import random
import re
import json
import base64
import argparse
import functools
import urllib.parse
from pathlib import Path
import requests
from playwright.sync_api import sync_playwright

# Force unbuffered output so all docker logs appear instantaneously
print = functools.partial(print, flush=True)

# ─── Configuration ────────────────────────────────────────────────────────────
BASE_DIR = Path(__file__).resolve().parent
if (BASE_DIR / "storage").exists() or (BASE_DIR / "package.json").exists() or (BASE_DIR / ".env").exists():
    ROOT_DIR = BASE_DIR
else:
    ROOT_DIR = BASE_DIR.parent

COOKIES_DIR = ROOT_DIR / "storage" / "whop-cookies"
DEBUG_DIR = ROOT_DIR / "storage" / "whop-debug"
COOKIES_DIR.mkdir(parents=True, exist_ok=True)
DEBUG_DIR.mkdir(parents=True, exist_ok=True)

def _load_env_file():
    for candidate in [Path.cwd() / ".env", BASE_DIR / ".env", ROOT_DIR / ".env"]:
        if candidate.exists():
            try:
                with open(candidate, "r", encoding="utf-8") as f:
                    for line in f:
                        line = line.strip()
                        if line and not line.startswith("#") and "=" in line:
                            k, v = line.split("=", 1)
                            k = k.strip()
                            v = v.strip().strip("'\"")
                            if k not in os.environ:
                                os.environ[k] = v
                break
            except Exception:
                pass

_load_env_file()

SERVER_URL = os.environ.get("CREATOR_HUB_URL", "http://web:3000").rstrip("/")
API_KEY = os.environ.get("VPS_API_KEY") or os.environ.get("MAIN_VPS_API_KEY", "")
POLL_INTERVAL_SEC = int(os.environ.get("POLL_INTERVAL_SEC", "15"))
HEADLESS = os.environ.get("HEADLESS", "true").strip().lower() in ("true", "1", "yes", "y")
DISCORD_WEBHOOK_URL = os.environ.get("DISCORD_WEBHOOK_URL", "")

# ─── Humanization Helpers ─────────────────────────────────────────────────────

def human_wait(page, base_ms: int, variance: float = 0.4, long_pause_chance: float = 0.08):
    """Waits a randomized duration centered around base_ms to mimic natural behavior."""
    if random.random() < long_pause_chance:
        wait_ms = int(base_ms * random.uniform(2.0, 3.5))
    else:
        std_dev = base_ms * variance
        wait_ms = int(random.gauss(base_ms, std_dev))
    wait_ms = max(150, wait_ms)
    try:
        page.wait_for_timeout(wait_ms)
    except Exception:
        time.sleep(wait_ms / 1000.0)


def human_type(locator, text: str, min_delay_ms: int = 40, max_delay_ms: int = 140):
    """Clears the field and types text one character at a time with randomized delay."""
    locator.click(click_count=3)
    locator.press("Backspace")
    for ch in text:
        locator.type(ch, delay=random.randint(min_delay_ms, max_delay_ms))


# ─── Cookie / Storage State Management ────────────────────────────────────────

def get_cookie_file_path(whop_email: str) -> Path:
    """Returns local path for storing this email's auth state."""
    safe_name = re.sub(r'[^a-zA-Z0-9_.-]', '_', whop_email.strip().lower())
    return COOKIES_DIR / f"auth_state_{safe_name}.json"


def prepare_auth_state(whop_email: str, cookies_payload: str = None) -> Path:
    """
    Ensures a valid Playwright storage_state file exists for the given email.
    Prefers fresh cookies from server payload, then local storage, then fallback auth_state.json.
    """
    target_path = get_cookie_file_path(whop_email)

    # 1. If server returned fresh cookies from Credential table, save it
    if cookies_payload:
        try:
            parsed = json.loads(cookies_payload) if isinstance(cookies_payload, str) else cookies_payload
            # Format if raw cookies array was sent
            if isinstance(parsed, list):
                storage_obj = {"cookies": parsed, "origins": []}
            elif isinstance(parsed, dict) and "cookies" in parsed:
                storage_obj = parsed
            else:
                storage_obj = {"cookies": [], "origins": []}

            with open(target_path, "w", encoding="utf-8") as f:
                json.dump(storage_obj, f, indent=2)
            print(f"🔑 [Auth] Saved server cookies for {whop_email} to {target_path}")
            return target_path
        except Exception as e:
            print(f"⚠️ [Auth] Could not write server cookies payload: {e}")

    # 2. If email-specific cookie file already exists, use it
    if target_path.exists() and target_path.stat().st_size > 20:
        return target_path

    # 3. Check whop-submission/auth_state.json as fallback
    fallback_paths = [
        ROOT_DIR / "whop-submission" / "auth_state.json",
        ROOT_DIR / "auth_state.json",
        BASE_DIR / "auth_state.json",
    ]
    for fb in fallback_paths:
        if fb.exists() and fb.stat().st_size > 20:
            print(f"ℹ️ [Auth] Using default fallback auth state from {fb} for {whop_email}")
            return fb

    print(f"⚠️ [Auth] No saved cookies found for {whop_email}. Browser may require login.")
    return None


# ─── Whop UI Navigation & Submission Engine (from main.py) ───────────────────

REQUIREMENT_LABELS = [
    "Posted from one of your linked accounts",
    "Not already submitted to this campaign",
    "Posted within the last",
]

MODAL_ANCHOR_RE = re.compile(r"Post your clip|Submit video link", re.IGNORECASE)
FAIL_COLOR_MARKERS = ["255, 51, 85"]

# Red inline error messages that may appear after pasting a link (e.g. "30 minutes" timing error)
INLINE_RED_ERROR_SELECTORS = [
    "p[class*='text-[#f35]']",
    "p[class*='text-[#ff3355]']",
    "p[class*='text-red']",
    "[class*='text-[#f35]']",
    "[class*='text-[#ff3355]']",
    "[class*='text-red-']",
]


def get_app_frame(page):
    """Locates the Whop 'Content Rewards' app iframe with multiple fallbacks."""
    try:
        frame_loc = page.frame_locator("iframe[title='Content Rewards']")
        if frame_loc.locator(":root").count() > 0:
            return frame_loc
    except Exception:
        pass

    app_frame = page.frame(name="active-app-container")
    if app_frame:
        return app_frame

    for frame in page.frames:
        frame_name = frame.name or ""
        frame_url = frame.url or ""
        if "active-app-container" in frame_name or "contentrewards" in frame_url:
            return frame

    return page


def dismiss_onboarding_popups(page, job_id: str):
    """
    Waits up to 40s for 'Got it' welcome popup as requested by user.
    """
    print(f"[{job_id}] Waiting for 'Got it' welcome popup (up to 40s)...")
    start_time = time.time()
    got_it_dismissed = False
    while time.time() - start_time < 40:
        try:
            btn = page.locator("button:has-text('Got it'), button:has-text('Done')").first
            if btn.is_visible():
                print(f"[{job_id}] 'Got it' welcome popup detected. Dismissing...")
                btn.click()
                got_it_dismissed = True
                human_wait(page, 1500)
                break
        except Exception:
            pass
        page.wait_for_timeout(600)

    if got_it_dismissed:
        print(f"[{job_id}] 'Got it' popup dismissed.")
    else:
        print(f"[{job_id}] No 'Got it' popup appeared within 40s — continuing.")


def _clean_campaign_search_terms(campaign_name: str) -> list:
    """
    Extracts high-accuracy search variants from a campaign name.
    e.g. 'Lula Granji x The Packed Lunch — Campaign Rules'
    -> ['Lula Granji x The Packed Lunch', 'Lula Granji', 'The Packed Lunch']
    """
    # Remove rules suffix
    base = re.sub(r"\s*[—–-]\s*(campaign\s*)?rules.*$", "", campaign_name, flags=re.I).strip()
    base = re.sub(r"\(.*?\)", "", base).strip()

    terms = [base]
    if " x " in base:
        parts = [p.strip() for p in base.split(" x ") if p.strip()]
        terms.extend(parts)
        if len(parts) >= 2:
            terms.append(f"{parts[0]} x {parts[1]}")

    seen = set()
    cleaned = []
    for t in terms:
        tc = t.strip()
        if tc and tc.lower() not in seen:
            seen.add(tc.lower())
            cleaned.append(tc)
    return cleaned


def _build_preview_link_locator(ctx, terms: list):
    """
    Returns a Playwright locator (never stale) for the campaign card anchor tag.
    From HTML analysis: cards are <a aria-label="Preview CAMPAIGN_NAME" href="...">
    This is the most reliable selector — avoids DOM detachment errors from stale .all() references.
    """
    for term in terms:
        if len(term.strip()) < 3:
            continue
        try:
            # Match: <a aria-label="Preview CAMPAIGN_NAME">
            loc = ctx.get_by_role("link", name=re.compile(r"Preview\s+.*" + re.escape(term.strip()), re.I))
            if loc.count() > 0:
                return loc.first, term
        except Exception:
            pass
        try:
            # Match any <a> whose aria-label contains term (case-insensitive)
            loc = ctx.locator(f"a[aria-label*='{term.strip()}' i]")
            if loc.count() > 0:
                return loc.first, term
        except Exception:
            pass
    return None, None


def _click_card_locator(ctx, page, loc, job_id: str) -> bool:
    """
    Safely clicks a card locator and waits for campaign detail page to appear.
    Returns True if detail page (Submit clip button) became visible.
    """
    try:
        loc.scroll_into_view_if_needed()
        human_wait(page, 400)
    except Exception:
        pass

    try:
        loc.click(timeout=5000)
    except Exception:
        try:
            loc.click(force=True)
        except Exception as ce:
            print(f"[{job_id}] Card click error: {ce}")
            return False

    human_wait(page, 1200)

    # Check if 'Submit clip' button appeared → detail view loaded
    for _ in range(20):
        for check_ctx in [ctx, page]:
            if check_ctx is None:
                continue
            try:
                btn = check_ctx.locator("button:has-text('Submit clip'):visible").first
                if btn.is_visible():
                    return True
            except Exception:
                pass
        page.wait_for_timeout(500)
    return False


def _wait_for_campaign_cards_ready(page, target, job_id: str, timeout: int = 30000) -> bool:
    """
    Waits for Whop Content Rewards campaign cards to render on page.
    Uses the aria-label="Preview ..." anchor pattern confirmed from HTML analysis.
    Also dismisses any 'Got it' / 'Done' tutorial popup that may block the view.
    """
    print(f"[{job_id}] Waiting for campaign cards to load on page (up to {timeout // 1000}s)...")
    start = time.time()
    while time.time() - start < (timeout / 1000):
        # Dismiss any lingering Got it / Done popup
        try:
            got_it = page.locator("button:has-text('Got it'), button:has-text('Done')").first
            if got_it.is_visible():
                print(f"[{job_id}] 'Got it' popup detected. Dismissing...")
                got_it.click()
                human_wait(page, 1000)
        except Exception:
            pass

        # Check for campaign preview cards using the confirmed aria-label pattern
        for ctx in [target, page]:
            if ctx is None:
                continue
            try:
                cards = ctx.locator("a[aria-label^='Preview'], a[aria-label*='Preview']")
                if cards.count() > 0:
                    print(f"[{job_id}] ✅ Campaign cards loaded on page ({cards.count()} preview links found).")
                    return True
            except Exception:
                pass

        # Also check for the campaign count text ("19 campaigns", "14 campaigns")
        for ctx in [target, page]:
            if ctx is None:
                continue
            try:
                counter = ctx.locator("p:has-text('campaigns'), span:has-text('campaigns')")
                if counter.count() > 0:
                    print(f"[{job_id}] ✅ Campaign list counter visible — page ready.")
                    return True
            except Exception:
                pass

        page.wait_for_timeout(800)
    return False


def _wait_for_search_input_ready(page, job_id: str, timeout: int = 8000):
    """Lightweight fallback check for search input if direct page scan does not find the card."""
    selectors = [
        "input[placeholder*='favorite brands' i]",
        "input[placeholder*='platform and budget' i]",
        "input[aria-label='Search campaigns']",
        "form.relative input",
        "form input.min-w-0",
        "form input",
    ]
    start = time.time()
    while time.time() - start < (timeout / 1000):
        for sel in selectors:
            try:
                loc = page.locator(sel).first
                if loc.is_visible():
                    return loc
            except Exception:
                continue
        page.wait_for_timeout(500)
    return None


def _find_and_open_campaign(page, target, job_id: str, campaign_name: str, channel_link: str = ""):
    """
    Finds the campaign card using aria-label="Preview CAMPAIGN_NAME" anchors,
    confirmed from live HTML analysis of the Content Rewards iframe.

    Strategy (no stale element refs — locators are lazy):
    1. Wait for cards to render + dismiss 'Got it' popup.
    2. Use get_by_role('link', name='Preview ..') locator in iframe first.
    3. Scroll down (up to 8x500px) to find cards not in initial viewport.
    4. Scroll back up + final check.
    5. Search box fallback only if everything else fails.
    """
    terms = _clean_campaign_search_terms(campaign_name)
    print(f"[{job_id}] Target campaign: '{campaign_name}' (Search terms: {terms})")

    # Step 1: Wait for campaign card anchors to render & dismiss 'Got it' popup
    _wait_for_campaign_cards_ready(page, target, job_id, timeout=30000)
    human_wait(page, 800)

    # Helper: try finding the locator in both target (iframe) and page
    def try_find_and_click():
        for ctx in [target, page]:
            if ctx is None:
                continue
            loc, matched = _build_preview_link_locator(ctx, terms)
            if loc is not None:
                print(f"[{job_id}] ✅ Found card matching '{matched}' in {'iframe' if ctx is target else 'page'}. Clicking...")
                loaded = _click_card_locator(ctx, page, loc, job_id)
                if loaded:
                    print(f"[{job_id}] ✅ Campaign detail view loaded (Submit clip button visible).")
                else:
                    print(f"[{job_id}] Card clicked — proceeding to submission.")
                return True
        return False

    # Step 2: Check current viewport
    print(f"[{job_id}] Scanning for aria-label='Preview ...' campaign links...")
    if try_find_and_click():
        return

    # Step 3: Scroll down to reveal cards below the fold (up to 8 scrolls)
    print(f"[{job_id}] Card not in viewport. Scrolling down to find campaign...")
    for scroll_round in range(8):
        page.mouse.wheel(0, 500)
        human_wait(page, 600)
        if try_find_and_click():
            return

    # Step 4: Scroll back to top + final retry
    print(f"[{job_id}] Resetting scroll to top for final pass...")
    page.mouse.wheel(0, -5000)
    human_wait(page, 1200)
    if try_find_and_click():
        return

    # Step 5: Fallback — use the search box, then re-scan
    print(f"[{job_id}] Trying search box as final fallback...")
    try:
        for search_ctx in [target, page]:
            if search_ctx is None:
                continue
            try:
                search_input = search_ctx.locator(
                    "input[placeholder*='favorite brands' i], "
                    "input[placeholder*='Find your favorite brands' i], "
                    "input[placeholder*='Search' i]"
                ).first
                if search_input.is_visible(timeout=3000):
                    search_input.click(force=True)
                    human_wait(page, 200)
                    search_input.fill(terms[0])
                    human_wait(page, 2500)
                    if try_find_and_click():
                        return
                    break
            except Exception:
                continue
    except Exception as fb_err:
        print(f"[{job_id}] Search box fallback note: {fb_err}")

    raise Exception(f"Campaign '{campaign_name}' (tried terms: {terms}) not found on page")


def _modal_anchor(target):
    # Try finding modern Whop modal dialog or text
    for sel in ["div[role='dialog']", "[data-modal]", "label[data-clip-picker-block]"]:
        try:
            loc = target.locator(sel).first
            if loc.is_visible(timeout=800):
                return loc
        except Exception:
            continue
    return target.get_by_text(MODAL_ANCHOR_RE).first


def _find_link_input(target):
    """
    Locates the video link input in the Whop submission modal (Screenshot 6).
    <input placeholder="Paste a link" aria-label="Clip link">
    """
    candidates = [
        target.locator("input[aria-label='Clip link']").first,
        target.get_by_role("textbox", name="Clip link").first,
        target.locator("input[placeholder*='Paste a link' i]").first,
        target.get_by_placeholder("Paste a link").first,
        target.locator("input[placeholder*='Paste' i]").first,
        target.locator("input[placeholder*='link' i]").first,
        target.locator("label[data-clip-picker-block] input").first,
        target.locator("div[role='dialog'] input[type='text'], div[role='dialog'] input:not([type='checkbox'])").first,
        target.locator("input:visible:not([type='checkbox']):not([type='hidden']):not([type='radio'])").first,
    ]
    for sel in candidates:
        try:
            if sel.is_visible(timeout=1000):
                return sel
        except Exception:
            continue

    raise Exception("Could not find video link input field in Whop submission modal")


def _is_modal_open(target) -> bool:
    """Checks if the Whop submission modal is currently visible on screen."""
    try:
        loc = _find_link_input(target)
        if loc.is_visible(timeout=1200):
            return True
    except Exception:
        pass

    try:
        if target.locator("button:has-text('Submit clip'):visible").count() > 0:
            return True
    except Exception:
        pass

    return False


def _modal_submit_btn(target):
    """Returns the 'Submit clip' button inside the active modal (Screenshot 9)."""
    for sel in [
        "div[role='dialog'] button:has-text('Submit clip')",
        "[data-modal] button:has-text('Submit clip')",
        "button.relative:has-text('Submit clip')",
    ]:
        try:
            btn = target.locator(sel).last
            if btn.is_visible(timeout=800):
                return btn
        except Exception:
            continue
    return target.locator("button:has-text('Submit clip'):visible").last


def _agree_label(target):
    """
    Locates agreement checkbox / label in the Whop submission modal (Screenshots 7 & 8).
    <label class="..."> I've read the requirements and accept that non-compliant clips may be auto-rejected.
    """
    candidates = [
        target.locator("label:has-text('read the requirements')").first,
        target.locator("label:has-text('non-compliant')").first,
        target.locator("label").filter(has_text=re.compile(r"read the requirements|non-compliant", re.IGNORECASE)).first,
        target.locator("span.grid.size-\\[22px\\]").first,
    ]
    for c in candidates:
        try:
            if c.is_visible(timeout=1000):
                return c
        except Exception:
            continue
    return target.locator("label:has-text('I\'ve read the requirements')").first


def _submit_enabled(btn) -> bool:
    try:
        return (btn.get_attribute("aria-disabled", timeout=1000) or "").lower() != "true"
    except Exception:
        return False


def _wait_submit_enabled(page, btn, timeout_s: float) -> bool:
    end = time.time() + timeout_s
    while time.time() < end:
        if _submit_enabled(btn):
            return True
        page.wait_for_timeout(300)
    return _submit_enabled(btn)


def _get_failed_requirement_reasons(target) -> list:
    failed_reasons = []
    for label in REQUIREMENT_LABELS:
        try:
            row = target.locator("div.flex.w-full.items-center.justify-between").filter(has_text=label).first
            dot = row.locator("span.rounded-full").last
            color = dot.evaluate("el => getComputedStyle(el).backgroundColor")
        except Exception:
            continue

        if any(marker in color for marker in FAIL_COLOR_MARKERS):
            label_lower = label.lower()
            if "linked accounts" in label_lower:
                failed_reasons.append("Video not posted from a linked account")
            elif "already submitted" in label_lower:
                failed_reasons.append("Video already submitted to this campaign")
            elif "posted within" in label_lower:
                failed_reasons.append("Video was not posted recently enough for this campaign")
            else:
                failed_reasons.append(f"Failed requirement: {label}")
    return failed_reasons


def _get_inline_red_error(target, page) -> str:
    """
    Checks for inline red error messages that appear immediately after pasting the link.
    E.g.: 'Posts have to be submitted within 30 minutes of going live...'
    Returns error text if found, empty string otherwise.
    """
    for ctx in [target, page]:
        if ctx is None:
            continue
        for sel in INLINE_RED_ERROR_SELECTORS:
            try:
                loc = ctx.locator(sel).first
                if loc.is_visible(timeout=300):
                    txt = (loc.text_content() or "").strip()
                    if txt and len(txt) > 5:
                        return txt
            except Exception:
                continue

        # Also check by computed color — any <p> or <span> with red computed color
        try:
            candidates = ctx.locator("p, span").all()
            for c in candidates[:40]:
                try:
                    if not c.is_visible():
                        continue
                    txt = (c.text_content() or "").strip()
                    if not txt or len(txt) < 10:
                        continue
                    color = c.evaluate("el => getComputedStyle(el).color")
                    # rgb(255, 51, 85) or similar red
                    if "255, 51" in color or "255, 0" in color:
                        return txt
                except Exception:
                    continue
        except Exception:
            pass
    return ""


def _poll_for_done_or_error(page, target, job_id: str, poll_seconds: int = 30) -> tuple:
    """
    Polls every 2s for up to `poll_seconds` waiting for either:
    - 'Done' / 'Got it' popup → returns ("done", "")
    - Inline red error text → returns ("error", error_text)
    - Requirement validation failure → returns ("error", error_text)
    Returns ("timeout", "") if neither appears.
    """
    print(f"[{job_id}] Polling every 2s for Done popup or error (up to {poll_seconds}s)...")
    end_time = time.time() + poll_seconds
    while time.time() < end_time:
        # Check 1: Done/Got it popup
        got_it = _find_got_it_button(page, target)
        if got_it is not None:
            print(f"[{job_id}] ✅ 'Done' popup detected!")
            return ("done", "")

        # Check 2: Inline red error (e.g. "30 minutes" timing error)
        red_err = _get_inline_red_error(target, page)
        if red_err:
            print(f"[{job_id}] ❌ Inline red error detected: {red_err}")
            return ("error", red_err)

        # Check 3: Requirement validation dot errors
        reasons = _get_failed_requirement_reasons(target)
        if reasons:
            err_text = "; ".join(reasons)
            print(f"[{job_id}] ❌ Validation failure detected: {err_text}")
            return ("error", err_text)

        page.wait_for_timeout(2000)

    return ("timeout", "")


def _fill_submission_form(page, target, job_id: str, video_link: str):
    """Fills video link input and ticks agreement checkbox."""
    print(f"[{job_id}] Locating video link input in modal...")
    link_input = _find_link_input(target)
    link_input.wait_for(state="visible", timeout=10000)

    print(f"[{job_id}] Pasting video link: '{video_link}'...")
    human_wait(page, 400)
    link_input.scroll_into_view_if_needed()
    link_input.click(force=True)
    human_wait(page, 200)

    # 1. Clear existing text
    link_input.press("Control+A")
    link_input.press("Backspace")
    human_wait(page, 200)

    # 2. Fill link
    link_input.fill(video_link)
    human_wait(page, 500)

    # 3. Check value and dispatch synthetic events so React hook registers it
    val = ""
    try:
        val = link_input.input_value().strip()
    except Exception:
        pass

    if val != video_link:
        # Fallback to realistic keystroke typing
        link_input.click(force=True)
        link_input.press("Control+A")
        link_input.press("Backspace")
        human_type(link_input, video_link)
        human_wait(page, 500)

    # Dispatch native React input events to trigger Whop's YouTube link validation
    try:
        link_input.evaluate("""(el, val) => {
            el.value = val;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
        }""", video_link)
    except Exception:
        pass

    # Wait for Whop's link validator to check URL
    human_wait(page, 1500)

    print(f"[{job_id}] Ticking agreement checkbox...")
    label = _agree_label(target)
    label.wait_for(state="visible", timeout=8000)
    label.scroll_into_view_if_needed()

    inner_cb = label.locator("input[type='checkbox']").first
    has_inner = False
    try:
        has_inner = inner_cb.count() > 0
    except Exception:
        pass

    if has_inner:
        if not inner_cb.is_checked():
            label.click(force=True)
            human_wait(page, 500)
        if not inner_cb.is_checked():
            inner_cb.check(force=True)
    else:
        label.click(force=True)
    human_wait(page, 600)

    btn = _modal_submit_btn(target)
    if not _wait_submit_enabled(page, btn, 4):
        print(f"[{job_id}] 'Submit clip' disabled -- retyping link with real keystrokes...")
        try:
            link_input.click(force=True)
            link_input.press("Control+A")
            link_input.press("Backspace")
            human_type(link_input, video_link)
        except Exception:
            pass
        human_wait(page, 1500)
        if not _wait_submit_enabled(page, btn, 6):
            reasons = _get_failed_requirement_reasons(target)
            if reasons:
                raise Exception("Validation failed: " + "; ".join(reasons))
            raise Exception("'Submit clip' stayed disabled after filling link and ticking agreement")
    human_wait(page, 400)


def _find_got_it_button(page, target):
    name_pattern = re.compile(r"^\s*(got it!?|done!?)\s*$", re.IGNORECASE)
    candidates = []
    try: candidates.append(target.get_by_role("button", name=name_pattern).first)
    except: pass
    try: candidates.append(page.get_by_role("button", name=name_pattern).first)
    except: pass
    for cand in candidates:
        try:
            if cand.is_visible():
                return cand
        except:
            continue
    return None


def _dismiss_success_confirmation(page, target, job_id: str):
    """Clicks 'Done' / 'Got it!' confirmation dialog so modal closes properly."""
    for attempt in range(1, 4):
        btn = _find_got_it_button(page, target)
        if btn is None:
            break
        try:
            print(f"[{job_id}] Clicking 'Done' confirmation (attempt {attempt}/3)...")
            human_wait(page, 600)
            btn.click()
        except Exception as e:
            print(f"[{job_id}] 'Done' click note: {e}")

        end = time.time() + 5
        while time.time() < end:
            page.wait_for_timeout(400)
            if _find_got_it_button(page, target) is None:
                human_wait(page, 800)
                print(f"[{job_id}] 'Done' confirmation dismissed.")
                break

    # Dismiss any lingering backdrop or modal dialog with Escape
    try:
        page.keyboard.press("Escape")
        page.wait_for_timeout(400)
    except Exception:
        pass


def _submit_for_approval(page, target, job_id: str, max_retries: int = 3):
    """
    Clicks the modal 'Submit clip' button then polls every 2s for:
    - 'Done' / 'Got it' popup → success, dismiss and return
    - Inline red error text (e.g. '30 minutes' timing error) → raise Exception
    - Requirement validation dot failure → raise Exception
    Retries up to max_retries times if submission reverts.
    """
    submit_btn = _modal_submit_btn(target)
    submit_btn.wait_for(state="visible", timeout=10000)

    for attempt in range(1, max_retries + 1):
        # Already done from a previous attempt?
        if attempt > 1 and _find_got_it_button(page, target) is not None:
            print(f"[{job_id}] ✅ Submission already confirmed (Done popup found before retry).")
            _dismiss_success_confirmation(page, target, job_id)
            return

        print(f"[{job_id}] Clicking modal 'Submit clip' (attempt {attempt}/{max_retries})...")
        human_wait(page, 500)
        try:
            submit_btn.click()
        except Exception:
            submit_btn.click(force=True)

        # ── Poll every 2s for Done OR error ──────────────────────────────────
        print(f"[{job_id}] Waiting for outcome (checking every 2s, up to 40s)...")
        end_time = time.time() + 40
        outcome = None
        outcome_detail = ""

        while time.time() < end_time:
            page.wait_for_timeout(2000)

            # 1. Done/Got it popup → success
            if _find_got_it_button(page, target) is not None:
                outcome = "done"
                break

            # 2. Inline red error paragraph (e.g. "30 minutes" timing error from screenshot)
            red_err = _get_inline_red_error(target, page)
            if red_err:
                outcome = "inline_red_error"
                outcome_detail = red_err
                break

            # 3. Requirement validation dot failures
            reasons = _get_failed_requirement_reasons(target)
            if reasons:
                outcome = "validation_failed"
                outcome_detail = "; ".join(reasons)
                break

            # 4. Modal closed without Done → treat as success
            if not _is_modal_open(target):
                outcome = "done"
                break

            # 5. Button text reverted back to "Submit clip" → retry
            try:
                btn_text = submit_btn.inner_text(timeout=800).strip().lower()
                if btn_text == "submit clip":
                    outcome = "reverted"
                    break
            except Exception:
                pass

        # ── Handle outcome ────────────────────────────────────────────────────
        if outcome == "done":
            print(f"[{job_id}] ✅ Submission succeeded!")
            _dismiss_success_confirmation(page, target, job_id)
            return

        if outcome in ("inline_red_error", "validation_failed"):
            raise Exception(f"Submission failed: {outcome_detail}")

        if outcome == "reverted":
            print(f"[{job_id}] Submit reverted. Retrying...")
            human_wait(page, 2000)
            continue

        # Timeout — final check before giving up on this attempt
        if _find_got_it_button(page, target) is not None:
            print(f"[{job_id}] ✅ Done popup found after timeout — success.")
            _dismiss_success_confirmation(page, target, job_id)
            return
        red_err = _get_inline_red_error(target, page)
        if red_err:
            raise Exception(f"Submission failed: {red_err}")
        reasons = _get_failed_requirement_reasons(target)
        if reasons:
            raise Exception(f"Submission failed: {'; '.join(reasons)}")

    raise Exception(f"Submission did not complete after {max_retries} attempts.")


def process_submission(page, job_id: str, campaign_name: str, video_link: str, channel_link: str = ""):
    """Full submission flow: Search Campaign → Click Card → Submit clip → Paste link → Submit → Done."""
    target = get_app_frame(page)
    human_wait(page, 600)

    # Step 1: Search & open campaign card directly
    _find_and_open_campaign(page, target, job_id, campaign_name, channel_link=channel_link)

    # Step 2: Click page-level 'Submit clip' button to open modal (Screenshot 5)
    print(f"[{job_id}] Clicking 'Submit clip' button to open modal...")
    submit_clip_btn = None
    for cand in [
        target.locator("button:has-text('Submit clip'):visible").first,
        page.locator("button:has-text('Submit clip'):visible").first,
        target.get_by_role("button", name=re.compile(r"^submit clip$", re.I)).first,
        page.get_by_role("button", name=re.compile(r"^submit clip$", re.I)).first,
    ]:
        try:
            if cand.is_visible(timeout=3000):
                submit_clip_btn = cand
                break
        except Exception:
            continue

    if submit_clip_btn is None:
        submit_clip_btn = target.locator("button:has-text('Submit clip'):visible").first
        submit_clip_btn.wait_for(state="visible", timeout=10000)

    submit_clip_btn.scroll_into_view_if_needed()
    human_wait(page, 400)
    try:
        submit_clip_btn.click(timeout=5000)
    except Exception:
        print(f"[{job_id}] Submit clip click intercepted — forcing click...")
        try:
            page.keyboard.press("Escape")
            page.wait_for_timeout(400)
        except Exception:
            pass
        submit_clip_btn.click(force=True)
    human_wait(page, 1500)

    # Step 3: Paste link + tick agreement
    _fill_submission_form(page, target, job_id, video_link)

    # Step 4: Submit + click Done
    _submit_for_approval(page, target, job_id)


# ─── Creator Hub Worker Loop ──────────────────────────────────────────────────

def poll_for_job() -> dict:
    """Polls Creator Hub endpoint for the oldest pending Whop submission job."""
    url = f"{SERVER_URL}/api/worker/poll-whop-submission"
    headers = {"x-vps-key": API_KEY}
    params = {"apiKey": API_KEY}
    try:
        res = requests.get(url, headers=headers, params=params, timeout=15)
        if res.status_code == 200:
            data = res.json()
            if data.get("hasJob") and data.get("job"):
                return data["job"]
            msg = data.get("message", "No pending submissions")
            print(f"⏳ [Poll] {msg}")
        elif res.status_code == 403:
            print("⚠️ [Poll] VPS API Key not authorized or invalid.")
        else:
            print(f"⚠️ [Poll] Warning ({res.status_code}): {res.text[:120]}")
    except Exception as e:
        print(f"⚠️ [Poll] Network error: {e}")
    return None


def report_job_result(job_id: str, automation_id: str, status: str, error_message: str = None, time_taken: int = None, screenshot_base64: str = None):
    """Reports submission completion or failure back to Creator Hub, including screenshot if failed."""
    url = f"{SERVER_URL}/api/worker/report-whop-submission"
    headers = {"Content-Type": "application/json", "x-vps-key": API_KEY}
    payload = {
        "apiKey": API_KEY,
        "jobId": job_id,
        "automationId": automation_id,
        "status": status,
        "errorMessage": error_message,
        "timeTaken": time_taken,
        "screenshotBase64": screenshot_base64,
    }
    try:
        res = requests.post(url, json=payload, headers=headers, timeout=20)
        if res.status_code == 200:
            print(f"📝 [Report] Recorded {job_id} as {status} in Creator Hub.")
        else:
            print(f"⚠️ [Report] Failed to record result ({res.status_code}): {res.text[:120]}")
    except Exception as e:
        print(f"⚠️ [Report] Network error reporting result: {e}")


def main_worker_loop():
    print("───────────────────────────────────────────────────────────")
    print("🚀 Creator Hub — Dedicated Whop Submission Worker")
    print(f"📡 Server:        {SERVER_URL}")
    print(f"🔑 VPS API Key:   {API_KEY[:10]}••••••••" if API_KEY else "❌ MISSING API KEY")
    print(f"⏱️  Poll Interval: {POLL_INTERVAL_SEC}s")
    print(f"🖥️  Headless Mode: {HEADLESS}")
    print("───────────────────────────────────────────────────────────")

    if not API_KEY:
        print("❌ Error: VPS_API_KEY environment variable is required.")
        sys.exit(1)

    with sync_playwright() as p:
        while True:
            job = poll_for_job()
            if not job:
                time.sleep(POLL_INTERVAL_SEC)
                continue

            job_id        = job.get("jobId")
            automation_id = job.get("automationId")
            whop_email    = (job.get("whopEmail") or "").strip().lower()
            campaign_name = job.get("campaignName") or ""
            channel_link  = job.get("channelLink") or ""
            video_link    = job.get("videoLink") or ""
            video_title   = job.get("videoTitle") or "Short"
            cookies_payload = job.get("cookies")

            print(f"\n🎯 [Job {job_id}] Processing submission:")
            print(f"   Email:    {whop_email}")
            print(f"   Campaign: {campaign_name}")
            print(f"   Video:    {video_link}")
            print(f"   Title:    \"{video_title}\"")

            job_start_time = time.time()
            browser = None
            context = None
            page    = None

            try:
                # ── 1. Fresh browser for every submission ──────────────────
                browser = p.chromium.launch(
                    headless=HEADLESS,
                    args=[
                        "--no-sandbox",
                        "--disable-setuid-sandbox",
                        "--disable-dev-shm-usage",
                        "--disable-blink-features=AutomationControlled",
                    ]
                )

                # ── 2. Load this email's cookies ───────────────────────────
                auth_state_path = prepare_auth_state(whop_email, cookies_payload)
                if auth_state_path and auth_state_path.exists():
                    context = browser.new_context(storage_state=str(auth_state_path))
                    print(f"[{job_id}] Loaded cookies for {whop_email}")
                else:
                    context = browser.new_context()
                    print(f"[{job_id}] ⚠️ No cookies found for {whop_email} — proceeding without auth")

                page = context.new_page()

                # ── 3. Navigate to Whop channel ────────────────────────────
                print(f"[{job_id}] Navigating to: {channel_link}")
                page.goto(channel_link, wait_until="domcontentloaded", timeout=90000)
                human_wait(page, 4000, variance=0.15)

                # ── 4. Dismiss 'Got it' popup (community join skipped) ─────
                dismiss_onboarding_popups(page, job_id)

                # ── 5. Discover → Campaign → Submit clip → Paste → Submit ──
                process_submission(page, job_id, campaign_name, video_link, channel_link=channel_link)

                # ── 6. ✅ Success ───────────────────────────────────────────
                time_taken_min = max(1, int((time.time() - job_start_time) / 60))
                report_job_result(job_id, automation_id, "submitted", time_taken=time_taken_min)

            except Exception as sub_err:
                err_msg = str(sub_err)
                print(f"❌ [Job {job_id}] Submission error: {err_msg}")

                # Debug screenshot
                screenshot_b64 = None
                try:
                    if page:
                        shot_bytes = page.screenshot()
                        screenshot_path = DEBUG_DIR / f"fail_{job_id}_{int(time.time())}.png"
                        with open(screenshot_path, "wb") as sf:
                            sf.write(shot_bytes)
                        screenshot_b64 = base64.b64encode(shot_bytes).decode("utf-8")
                        print(f"📸 [Debug] Screenshot saved: {screenshot_path}")
                except Exception as s_err:
                    print(f"⚠️ [Debug] Screenshot error: {s_err}")

                time_taken_min = max(1, int((time.time() - job_start_time) / 60))
                report_job_result(
                    job_id, automation_id, "failed",
                    error_message=err_msg,
                    time_taken=time_taken_min,
                    screenshot_base64=screenshot_b64
                )

            finally:
                # ── 7. Always close browser after each submission ──────────
                try:
                    if context: context.close()
                except Exception: pass
                try:
                    if browser: browser.close()
                except Exception: pass
                print(f"[{job_id}] Browser closed. Polling for next job...")

            time.sleep(random.uniform(2.0, 4.5))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Creator Hub Whop Submission Worker")
    parser.add_argument("--key", type=str, default="", help="VPS API Key")
    parser.add_argument("--server", type=str, default="", help="Creator Hub Server URL")
    parser.add_argument("--headless", type=str, default="", help="Run browser in headless mode (true/false)")
    parser.add_argument("--interval", type=int, default=0, help="Poll interval in seconds")
    parser.add_argument("--login", action="store_true", help="Launch headed browser to log in and save cookies manually")
    parser.add_argument("--email", type=str, default="", help="Whop account email when saving cookies via --login")
    args = parser.parse_args()

    if args.key:
        API_KEY = args.key
    if args.server:
        SERVER_URL = args.server.rstrip("/")
    if args.headless:
        HEADLESS = args.headless.strip().lower() in ("true", "1", "yes", "y")
    if args.interval > 0:
        POLL_INTERVAL_SEC = args.interval

    if args.login:
        email = args.email.strip().lower() or input("Enter Whop Account Email: ").strip().lower()
        if not email:
            print("Email is required.")
            sys.exit(1)

        dest_file = get_cookie_file_path(email)
        print(f"\n=== Whop Manual Login for: {email} ===")
        with sync_playwright() as p:
            b = p.chromium.launch(headless=False)
            ctx = b.new_context()
            pg = ctx.new_page()
            pg.goto("https://whop.com/", wait_until="domcontentloaded")
            print("1. Log in manually in the browser window.")
            print("2. Once logged in, press ENTER here to save cookies.")
            input("Press ENTER to save cookies...")
            dest_file.parent.mkdir(parents=True, exist_ok=True)
            ctx.storage_state(path=str(dest_file))
            print(f"✅ Success! Cookies saved to: {dest_file}")
            b.close()
    else:
        main_worker_loop()
