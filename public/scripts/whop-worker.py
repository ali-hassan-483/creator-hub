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
    Dismisses the 'Got it' welcome popup if present (up to 5s check).
    """
    print(f"[{job_id}] Checking for 'Got it' welcome popup (up to 5s)...")
    start_time = time.time()
    while time.time() - start_time < 5:
        try:
            btn = page.locator("button:has-text('Got it')").first
            if btn.is_visible():
                print(f"[{job_id}] 'Got it' welcome popup detected. Dismissing...")
                btn.click()
                human_wait(page, 800)
                return
        except Exception:
            pass
        page.wait_for_timeout(400)
    print(f"[{job_id}] No 'Got it' popup appeared — continuing.")


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


def _find_campaign_card_on_page(page, term: str, timeout: int = 3000):
    """
    Finds the clickable campaign card on Whop Content Rewards (Screenshots 2 & 4).
    Iterates through elements containing term, strictly skipping inputs and search form elements.
    """
    locators_to_try = [
        # 1. Any image whose alt contains term
        page.locator(f"img[alt*='{term}' i]"),
        # 2. Text / heading inside Content Rewards
        page.locator("h1, h2, h3, h4, p, span, div").filter(has_text=re.compile(re.escape(term), re.I)),
        # 3. Direct text match
        page.get_by_text(re.compile(re.escape(term), re.I)),
    ]

    for loc in locators_to_try:
        try:
            loc.first.wait_for(state="visible", timeout=timeout)
        except Exception:
            continue

        count = 0
        try:
            count = loc.count()
        except Exception:
            pass

        for idx in range(count):
            cand = loc.nth(idx)
            try:
                if not cand.is_visible():
                    continue

                info = cand.evaluate("""el => {
                    const tag = el.tagName.toLowerCase();
                    const isInput = tag === 'input' || tag === 'textarea' || el.closest('form') !== null;
                    const rect = el.getBoundingClientRect();
                    return {
                        tag,
                        isInput,
                        width: rect.width,
                        height: rect.height,
                    };
                }""")

                # Skip input fields or anything inside the search form
                if info.get('isInput'):
                    continue

                # Skip 0-size elements
                if info.get('width', 0) < 10 or info.get('height', 0) < 10:
                    continue

                return cand
            except Exception:
                continue

    return None


def _find_search_input(page):
    """
    Finds the Content Rewards campaign search box at the bottom (Screenshots 1, 2, 3).
    Strictly avoids the global Whop site navbar search input.
    """
    selectors = [
        "form input[type='text']",
        "form input:not([type='hidden'])",
        "input[aria-label='Search campaigns']",
        "input[placeholder*='favorite brands' i]",
        "input[placeholder*='platform and budget' i]",
        "form.relative input",
        "form input",
    ]
    for sel in selectors:
        try:
            loc = page.locator(sel).first
            if loc.is_visible():
                return loc
        except Exception:
            pass

    for sel in selectors[:3]:
        try:
            loc = page.locator(sel).first
            loc.wait_for(state="visible", timeout=3000)
            if loc.is_visible():
                return loc
        except Exception:
            pass

    return None


def _find_and_open_campaign(page, target, job_id: str, campaign_name: str, channel_link: str = ""):
    """
    Multi-strategy search & open for Whop campaign card (Screenshots 1 through 5).
    1. Instant check: Is card already visible directly on screen?
    2. Interactive search: Type in bottom search box & press Enter (Screenshots 1, 2, 3).
    3. URL Query Fallback: Direct navigate to ?q=<term> (Screenshot 4).
    4. Click card & wait for detail view (Screenshot 5).
    """
    terms = _clean_campaign_search_terms(campaign_name)
    best_term = terms[0]
    print(f"[{job_id}] Target campaign: '{campaign_name}' (Search terms: {terms})")
    human_wait(page, 800)

    campaign_card = None

    # ── Strategy 1: Is card already on screen right now? ──────────────
    print(f"[{job_id}] Checking if campaign card is already visible on screen...")
    for term in terms:
        campaign_card = _find_campaign_card_on_page(page, term, timeout=1200)
        if campaign_card is not None:
            print(f"[{job_id}] ✅ Campaign '{term}' card is already visible on screen!")
            break

    # ── Strategy 2: Type in Content Rewards search box (Screenshots 1, 2, 3) ──
    if campaign_card is None:
        print(f"[{job_id}] Locating Content Rewards search input at bottom...")
        search_input = _find_search_input(page)
        if search_input:
            try:
                print(f"[{job_id}] Typing '{best_term}' into search input...")
                search_input.scroll_into_view_if_needed()
                search_input.click(force=True)
                human_wait(page, 150)
                search_input.fill("")
                human_wait(page, 100)
                human_type(search_input, best_term)
                human_wait(page, 200)
                search_input.press("Enter")

                # Also click search submit button if present (Screenshot 3)
                try:
                    s_btn = page.locator("button[aria-label='Search button'], form.relative button, form button").first
                    if s_btn.is_visible():
                        s_btn.click()
                except Exception:
                    pass

                human_wait(page, 2000)

                for term in terms:
                    campaign_card = _find_campaign_card_on_page(page, term, timeout=4000)
                    if campaign_card is not None:
                        print(f"[{job_id}] ✅ Found campaign card for '{term}' after search!")
                        break
            except Exception as se:
                print(f"[{job_id}] Search typing note: {se}")

    # ── Strategy 3: Direct URL query ?q= (Screenshot 4) ───────────────
    if campaign_card is None:
        try:
            curr = page.url or ""
            base = curr.split("?")[0].rstrip("/") if curr else (channel_link.split("?")[0].rstrip("/") if channel_link else "")
            if base:
                q_url = f"{base}/?q={urllib.parse.quote_plus(best_term)}"
                print(f"[{job_id}] Navigating directly with search query: {q_url}...")
                page.goto(q_url, wait_until="domcontentloaded", timeout=20000)
                human_wait(page, 2500)
                for term in terms:
                    campaign_card = _find_campaign_card_on_page(page, term, timeout=4000)
                    if campaign_card is not None:
                        print(f"[{job_id}] ✅ Found campaign card via direct query URL for '{term}'!")
                        break
        except Exception as q_err:
            print(f"[{job_id}] Query URL navigation note: {q_err}")

    # ── Strategy 4: Scroll down to reveal lazy-loaded cards ────────────
    if campaign_card is None:
        print(f"[{job_id}] Scrolling to find campaign card '{campaign_name}'...")
        for scroll_idx in range(4):
            page.mouse.wheel(0, 600)
            human_wait(page, 600)
            for term in terms:
                campaign_card = _find_campaign_card_on_page(page, term, timeout=1200)
                if campaign_card is not None:
                    print(f"[{job_id}] ✅ Found campaign card after scrolling!")
                    break
            if campaign_card is not None:
                break

    if campaign_card is None:
        raise Exception(f"Campaign '{campaign_name}' (tried terms: {terms}) not found on page")

    # ── Click the campaign card (Screenshots 2, 4, 5) ──────────────────
    print(f"[{job_id}] Clicking campaign card...")
    campaign_card.scroll_into_view_if_needed()
    human_wait(page, 300)
    try:
        campaign_card.click(timeout=4000)
    except Exception:
        campaign_card.click(force=True)

    # Trigger click on parent card container if detail page doesn't open immediately
    human_wait(page, 600)
    if page.locator("button:has-text('Submit clip'):visible").count() == 0:
        try:
            campaign_card.evaluate("""el => {
                let curr = el;
                while (curr && curr !== document.body) {
                    if (curr.classList && (curr.className.includes('rounded') || curr.className.includes('cursor-pointer') || curr.className.includes('transition'))) {
                        curr.click();
                        break;
                    }
                    curr = curr.parentElement;
                }
            }""")
        except Exception:
            pass

    # Wait for campaign detail page to load (Screenshot 5: orange 'Submit clip' button)
    print(f"[{job_id}] Waiting for campaign detail view to load...")
    details_loaded = False
    for wait_tick in range(15):
        try:
            btn = page.locator("button:has-text('Submit clip'):visible").first
            if btn.is_visible():
                details_loaded = True
                break
        except Exception:
            pass
        page.wait_for_timeout(500)

    if details_loaded:
        print(f"[{job_id}] ✅ Campaign detail view loaded successfully (Submit clip button visible).")
    else:
        print(f"[{job_id}] Proceeding to submit clip step.")

    # 4. If still not found, gently scroll down to reveal campaign cards
    if campaign_link is None:
        print(f"[{job_id}] Scrolling to find campaign card '{campaign_name}'...")
        for scroll_idx in range(5):
            page.mouse.wheel(0, 600)
            human_wait(page, 800)
            campaign_link = _locate_campaign_card(target, page, campaign_name, timeout=1500)
            if campaign_link is not None:
                break

    if campaign_link is None:
        raise Exception(f"Campaign '{campaign_name}' not found on page")

    print(f"[{job_id}] Clicking campaign card '{campaign_name}'...")
    campaign_link.scroll_into_view_if_needed()
    human_wait(page, 400)
    try:
        campaign_link.click(timeout=5000)
    except Exception:
        campaign_link.click(force=True)

    # Wait for campaign details page to load (Screenshot 5: orange 'Submit clip' button or '< Back')
    print(f"[{job_id}] Waiting for campaign detail view to load...")
    details_loaded = False
    for wait_tick in range(15):
        try:
            for ctx in [target, page]:
                btn = ctx.locator("button:has-text('Submit clip'):visible").first
                if btn.is_visible(timeout=800):
                    details_loaded = True
                    break
            if details_loaded:
                break
        except Exception:
            pass
        page.wait_for_timeout(500)

    if details_loaded:
        print(f"[{job_id}] Campaign detail view loaded successfully.")
    else:
        print(f"[{job_id}] Proceeding to submit clip step.")


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


def _submit_for_approval(page, target, job_id: str, max_retries: int = 5):
    """Submits the modal form and verifies success/Done confirmation."""
    submit_btn = _modal_submit_btn(target)
    submit_btn.wait_for(state="visible", timeout=10000)

    for attempt in range(1, max_retries + 1):
        if attempt > 1 and _find_got_it_button(page, target) is not None:
            _dismiss_success_confirmation(page, target, job_id)
            return

        print(f"[{job_id}] Clicking modal 'Submit clip' (attempt {attempt}/{max_retries})...")
        human_wait(page, 500)
        submit_btn.click()

        outcome = None
        start_wait_time = time.time()
        while time.time() - start_wait_time < 30:
            page.wait_for_timeout(random.randint(1200, 1800))

            if _find_got_it_button(page, target) is not None:
                outcome = "closed"
                break

            modal_open = _is_modal_open(target)
            if not modal_open:
                outcome = "closed"
                break

            if _get_failed_requirement_reasons(target):
                outcome = "red_error"
                break

            try:
                btn_text = submit_btn.inner_text(timeout=1000).strip().lower()
                if btn_text == "submit clip":
                    outcome = "reverted"
                    break
            except Exception:
                pass

        if outcome == "closed":
            print(f"[{job_id}] ✅ Submission succeeded!")
            _dismiss_success_confirmation(page, target, job_id)
            return

        if outcome == "red_error":
            reasons = _get_failed_requirement_reasons(target)
            raise Exception("Validation failed: " + "; ".join(reasons))

        human_wait(page, 2500, variance=0.2)
        if _find_got_it_button(page, target) is not None:
            _dismiss_success_confirmation(page, target, job_id)
            return
        if _get_failed_requirement_reasons(target):
            raise Exception("Validation failed: " + "; ".join(_get_failed_requirement_reasons(target)))

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
