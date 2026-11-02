import os
import sys
import argparse
import time
import random
import re
from pathlib import Path
import gspread
from oauth2client.service_account import ServiceAccountCredentials
from playwright.sync_api import sync_playwright

import config
import discord_logger

# ---------------------------------------------------------------------------
# Humanization helpers -- randomized delays and per-keystroke typing, to avoid
# looking like a scripted bot (fixed-duration waits and instant .fill() calls
# are an easy bot-detection signal).
# ---------------------------------------------------------------------------

def human_wait(page, base_ms: int, variance: float = 0.4, long_pause_chance: float = 0.08):
    """Waits a randomized duration centered around base_ms, with an occasional
    longer pause thrown in to mimic natural hesitation."""
    if random.random() < long_pause_chance:
        wait_ms = int(base_ms * random.uniform(2.0, 3.5))
    else:
        std_dev = base_ms * variance
        wait_ms = int(random.gauss(base_ms, std_dev))
    wait_ms = max(150, wait_ms)
    page.wait_for_timeout(wait_ms)


def human_type(locator, text: str, min_delay_ms: int = 40, max_delay_ms: int = 140):
    """Clears the field and types text one character at a time with a
    randomized per-keystroke delay, instead of an instant .fill()."""
    locator.click(click_count=3)
    locator.press("Backspace")
    for ch in text:
        locator.type(ch, delay=random.randint(min_delay_ms, max_delay_ms))

def run_login():
    """Headed browser login mode to capture and save cookies/localStorage."""
    print("====================================================")
    print("   Whop Login Mode (Headed Browser)                 ")
    print("====================================================")
    print("Starting browser...")
    
    with sync_playwright() as p:
        # Launch headed browser so the user can interact
        browser = p.chromium.launch(headless=False)
        context = browser.new_context()
        page = context.new_page()
        
        print("Navigating to Whop.com...")
        try:
            page.goto("https://whop.com/", wait_until="domcontentloaded", timeout=90000)
        except Exception as e:
            print(f"Warning: navigation wait timed out/failed: {e}. Continuing anyway, page may still be usable.")
        
        print("\nINSTRUCTIONS:")
        print("1. Manually login to your Whop account in the browser window.")
        print("2. Navigate to your dashboard or verify you are logged in.")
        print("3. Once logged in, return here and press ENTER to save cookies.")
        
        input("\nPress ENTER here to save session cookies and exit...")
        
        # Save storage state (cookies + localStorage)
        config.AUTH_STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
        context.storage_state(path=str(config.AUTH_STATE_PATH))
        print(f"\nSuccess! Cookies saved to: {config.AUTH_STATE_PATH}")
        
        browser.close()

def validate_session(page) -> bool:
    """Verifies if the loaded cookies session is still valid on Whop."""
    try:
        # Navigate to a generic internal page or hub
        page.goto("https://whop.com/hub/", wait_until="domcontentloaded")
        page.wait_for_timeout(3000)
        
        # If redirected to login page, session is invalid
        current_url = page.url
        if "/login" in current_url or page.locator("text='Sign in'").is_visible():
            return False
            
        return True
    except Exception as e:
        print(f"Error validating session: {e}")
        return False

def get_app_frame(page):
    """Locates the Whop 'Content Rewards' app iframe and returns a FrameLocator
    targeting it. Whop no longer sets a `name` attribute on this iframe and its
    src no longer contains 'contentrewards', so we target it by its stable
    title attribute instead. Falls back to the old name/url heuristics and
    finally to the main page if nothing matches, so this degrades gracefully
    if Whop changes the markup again."""
    try:
        frame_loc = page.frame_locator("iframe[title='Content Rewards']")
        # Sanity check the frame actually exists before trusting it
        if frame_loc.locator(":root").count() > 0:
            return frame_loc
    except Exception:
        pass

    # Fallback 1: previous name-based lookup, in case it comes back
    app_frame = page.frame(name="active-app-container")
    if app_frame:
        return app_frame

    # Fallback 2: previous url/name substring heuristic
    for frame in page.frames:
        frame_name = frame.name or ""
        frame_url = frame.url or ""
        if "active-app-container" in frame_name or "contentrewards" in frame_url:
            return frame

    # Last resort: main page
    return page

# ---------------------------------------------------------------------------
# Content Rewards v2 submission flow.
#
# Whop redesigned the Content Rewards app. The old flow was: land on channel
# page -> find campaign card by text match -> click "Submit Video" -> fill
# title/link/screenshot in a modal -> "Submit for approval".
#
# The new (v2) flow is: land on channel page -> click "Discover" nav link ->
# type the campaign name into a "Search campaigns" box -> click the matching
# campaign card (an <a> whose accessible name is "Preview <campaign name>") ->
# on the campaign detail page click "Submit clip" -> a modal opens with just a
# video-link input, 3 live requirement checks (linked account / not already
# submitted / posted recently), and an agreement checkbox -> click "Submit
# clip" again inside the modal.
#
# There is no title field and no demographics-screenshot field visible in the
# new modal, so those are no longer filled in. If a particular campaign still
# requires a screenshot, that will need a follow-up update once that flow is
# actually seen.
# ---------------------------------------------------------------------------

# Requirement row labels shown under the video link input. The third one has a
# trailing "<N> minutes" that varies per campaign, so we match on the stable
# prefix only.
REQUIREMENT_LABELS = [
    "Posted from one of your linked accounts",
    "Not already submitted to this campaign",
    "Posted within the last",
]


# The submission modal's heading changed. Old: "Submit video link". New:
# "Post your clip, then come back. You have 30 minutes to submit it."
# Everything in the modal is located relative to this text, so we match either
# wording and the script keeps working if Whop flips back.
MODAL_ANCHOR_RE = re.compile(r"Post your clip|Submit video link", re.IGNORECASE)


def _modal_anchor(target):
    return target.get_by_text(MODAL_ANCHOR_RE).first


def _modal_submit_btn(target):
    """The modal's own 'Submit clip' button (not the sticky one on the
    campaign page behind it) -- first matching button after the modal text."""
    return _modal_anchor(target).locator("xpath=following::button[contains(., 'Submit clip')][1]")


def _agree_label(target):
    """The agreement row is a <label> (custom checkbox, NOT role=checkbox --
    DevTools shows the box as a generic <span>), so we click the label."""
    return target.locator("label").filter(has_text=re.compile(r"read the requirements", re.IGNORECASE)).first


def _submit_enabled(btn) -> bool:
    """The modal's submit button stays aria-disabled='true' until the link is
    valid AND the agreement is ticked."""
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


def dismiss_onboarding_popups(page, row_idx: int):
    """Dismisses the 'Got it' welcome popup and the community-join overlay
    popup, if present. Both only appear the first time a channel page loads,
    so callers should only invoke this right after a fresh navigation.
    (The fixed 1-minute wait before clicking Discover has been removed.)"""
    print(f"[Row {row_idx}] Waiting for 'Got it' welcome popup (up to 30s)...")
    got_it_dismissed = False
    start_time = time.time()
    while time.time() - start_time < 30:
        try:
            btn = page.locator("button:has-text('Got it')").first
            if btn.is_visible():
                print(f"[Row {row_idx}] 'Got it' welcome popup detected. Dismissing...")
                btn.click()
                got_it_dismissed = True
                break
        except Exception:
            pass
        page.wait_for_timeout(500)

    if got_it_dismissed:
        page.wait_for_timeout(1000)
    else:
        print(f"[Row {row_idx}] No 'Got it' welcome popup appeared within 30s.")

    print(f"[Row {row_idx}] Waiting for community join popup (up to 30s)...")
    dismissed = False
    start_time = time.time()
    while time.time() - start_time < 30:
        try:
            btn = page.locator("button[aria-label='Dismiss']").first
            if btn.is_visible():
                print(f"[Row {row_idx}] Community join popup detected on main page. Dismissing...")
                btn.click()
                dismissed = True
                break
        except Exception:
            pass

        for frame in page.frames:
            try:
                btn = frame.locator("button[aria-label='Dismiss']").first
                if btn.is_visible():
                    print(f"[Row {row_idx}] Community join popup detected inside iframe '{frame.name or frame.url}'. Dismissing...")
                    btn.click()
                    dismissed = True
                    break
            except Exception:
                pass

        if dismissed:
            break
        page.wait_for_timeout(500)

    if dismissed:
        print(f"[Row {row_idx}] Community join popup dismissed.")
    else:
        print(f"[Row {row_idx}] No community join popup appeared within 30s.")


def _locate_campaign_card(target, campaign_name: str, timeout: int = 3000):
    """Tries to find the campaign card via aria-label (with progressively
    looser matching). Returns the locator if found & visible within timeout,
    else None. Does not raise -- callers decide what to do if nothing found."""
    candidates = [
        target.locator(f"[aria-label='Preview {campaign_name}']").first,
        target.locator(f"[aria-label*='{campaign_name}']").first,
        target.get_by_text(campaign_name, exact=False).first,
    ]
    for candidate in candidates:
        try:
            candidate.wait_for(state="visible", timeout=timeout)
            return candidate
        except Exception:
            continue
    return None


def _find_and_open_campaign(page, target, row_idx: int, campaign_name: str):
    """v2: clicks 'Discover', then finds the matching campaign card directly
    among the campaigns already listed there (the search box isn't always
    present/reliable, so it's only used as a fallback). Leaves the page on
    the campaign detail page (Views/Submissions tabs + sticky 'Submit clip'
    bar)."""
    print(f"[Row {row_idx}] Clicking 'Discover' tab...")
    # Matched by href, not accessible name/role -- the "Discover" label is
    # shared by more than one element (including an outer, unrelated global
    # Whop nav item), but only the in-app Content Rewards one links to a path
    # containing "/discover".
    discover_link = target.locator("a[href*='/discover']").first
    try:
        discover_link.wait_for(state="visible", timeout=20000)
    except Exception as e:
        raise Exception(f"'Discover' nav link not found: {e}")

    # A plain .click() does not reliably trigger this app's internal view
    # switch (looks like a React Router / SPA route change that needs the
    # full native pointer sequence, not just a synthetic "click"). Dispatch
    # pointerdown/mousedown/pointerup/mouseup/click by hand instead.
    discover_link.evaluate("""el => {
        ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(eventType => {
            el.dispatchEvent(new MouseEvent(eventType, {
                view: window,
                bubbles: true,
                cancelable: true,
                buttons: 1
            }));
        });
    }""")
    human_wait(page, 1400)

    # If nothing happened (native click didn't register), fall back to a real
    # native coordinate click before giving up on having switched views. Check
    # for any campaign card generically (not this specific campaign_name yet),
    # since we just want to confirm the Discover feed rendered at all.
    if target.locator("[aria-label*='Preview ']").first.count() == 0:
        box = discover_link.bounding_box()
        if box:
            page.mouse.click(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
            human_wait(page, 1400)

    # 1. Try to find the campaign directly among the campaigns already listed
    # on the Discover page -- no search needed if it's already visible there.
    print(f"[Row {row_idx}] Looking for campaign '{campaign_name}' directly on Discover page...")
    campaign_link = _locate_campaign_card(target, campaign_name, timeout=5000)

    # 2. If not immediately visible, scroll down a few times in case it's
    # further down a lazy-loaded / infinite-scroll list.
    if campaign_link is None:
        print(f"[Row {row_idx}] Not visible yet, scrolling to look for it...")
        for _ in range(6):
            page.mouse.wheel(0, 900)
            human_wait(page, 900)
            campaign_link = _locate_campaign_card(target, campaign_name, timeout=1500)
            if campaign_link is not None:
                break

    # 3. Last resort: use the search box, if one is present on this page.
    if campaign_link is None:
        print(f"[Row {row_idx}] Still not found by scrolling, trying search box as a fallback...")
        try:
            search_input = target.get_by_role("textbox", name="Search campaigns", exact=True).first
            if not search_input.is_visible(timeout=3000):
                search_input = target.get_by_placeholder("Search campaigns").first
            search_input.wait_for(state="visible", timeout=5000)
            human_wait(page, 400)
            human_type(search_input, campaign_name)
            search_input.press("Enter")
            human_wait(page, 5000, variance=0.15)
            campaign_link = _locate_campaign_card(target, campaign_name, timeout=8000)
        except Exception as e:
            print(f"[Row {row_idx}] Search box unavailable or failed ({e}), continuing without it.")

    if campaign_link is None:
        raise Exception(f"Campaign '{campaign_name}' not found on Discover page (direct look, scrolling, and search all failed)")

    print(f"[Row {row_idx}] Clicking campaign card...")
    campaign_link.scroll_into_view_if_needed()
    human_wait(page, 400)
    campaign_link.click()
    human_wait(page, 2000)


# Background colors used by the requirement status dots -- confirmed live:
# rgb(255, 51, 85) is the fail/red state. Anything else observed so far
# (rgb(238, 238, 238), Whop's neutral gray) is treated as passing/not-failed.
# If a genuine green "pass" color shows up later, add it here for clarity --
# it isn't required for correctness since we only flag known fail colors.
FAIL_COLOR_MARKERS = ["255, 51, 85"]


def _get_failed_requirement_reasons(target) -> list:
    """Reads each of the 3 requirement status dots and returns a list of
    clean, human-readable descriptions for whichever ones are currently red
    (failed). Empty list means no red errors are showing right now."""
    failed_reasons = []
    for label in REQUIREMENT_LABELS:
        try:
            row = target.locator("div.flex.w-full.items-center.justify-between").filter(has_text=label).first
            dot = row.locator("span.rounded-full").last
            color = dot.evaluate("el => getComputedStyle(el).backgroundColor")
        except Exception:
            continue

        is_fail = any(marker in color for marker in FAIL_COLOR_MARKERS)
        if is_fail:
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


def _read_requirement_statuses(target, row_idx: int) -> str:
    """Wraps _get_failed_requirement_reasons() into a single readable
    message, for cases where the modal is stuck with no clear cause."""
    failed_reasons = _get_failed_requirement_reasons(target)
    if failed_reasons:
        return "Validation failed: " + "; ".join(failed_reasons)
    return "Submission failed: modal stayed open after timeout (validation reason unclear)"


def _fill_submission_form(page, target, row_idx: int, video_link: str):
    """Fills the v2 submission modal: video link input + agreement checkbox,
    then waits for the modal's 'Submit clip' button to become enabled."""
    print(f"[Row {row_idx}] Locating video link input...")
    anchor = _modal_anchor(target)
    try:
        anchor.wait_for(state="visible", timeout=10000)
    except Exception as e:
        raise Exception(f"Submission modal did not open ('Post your clip' text not found): {e}")

    # First real text input after the modal text (skips checkboxes/hidden).
    link_input = anchor.locator(
        "xpath=following::input[not(@type='checkbox') and not(@type='hidden') and not(@type='radio')][1]"
    )
    try:
        link_input.wait_for(state="visible", timeout=10000)
    except Exception:
        # Fallback: any visible non-checkbox input in the frame.
        link_input = target.locator("input:visible:not([type='checkbox']):not([type='hidden'])").first
        try:
            link_input.wait_for(state="visible", timeout=5000)
        except Exception as e:
            raise Exception(f"Video link input not found in submission modal: {e}")

    print(f"[Row {row_idx}] Pasting link: '{video_link}'...")
    human_wait(page, 500)
    link_input.click()
    link_input.fill("")
    link_input.fill(video_link)  # paste-style
    human_wait(page, 800)
    try:
        if link_input.input_value().strip() != video_link:
            print(f"[Row {row_idx}] fill() didn't stick, typing the link key by key...")
            human_type(link_input, video_link)
    except Exception:
        pass
    human_wait(page, 1500)  # let the live requirement checks re-evaluate

    print(f"[Row {row_idx}] Ticking agreement checkbox...")
    label = _agree_label(target)
    try:
        label.wait_for(state="visible", timeout=8000)
    except Exception as e:
        raise Exception(f"Agreement checkbox row not found: {e}")
    label.scroll_into_view_if_needed()

    inner_cb = label.locator("input[type='checkbox']").first
    has_inner = False
    try:
        has_inner = inner_cb.count() > 0
    except Exception:
        pass

    if has_inner:
        # We can read the real state, so never toggle it off by accident.
        if not inner_cb.is_checked():
            label.click()
            human_wait(page, 500)
        if not inner_cb.is_checked():
            inner_cb.check(force=True)
    else:
        # Custom box with no readable state: click the label exactly once
        # (a second click would untick it). Verified via the button below.
        label.click()
    human_wait(page, 600)

    btn = _modal_submit_btn(target)
    if not _wait_submit_enabled(page, btn, 4):
        # Sometimes the app only validates on real keystrokes, not on a
        # programmatic fill -- retype the link once and look again.
        print(f"[Row {row_idx}] 'Submit clip' still disabled -- retyping link with real keystrokes...")
        try:
            human_type(link_input, video_link)
        except Exception as e:
            print(f"[Row {row_idx}] Retype failed: {e}")
        human_wait(page, 1500)
        if not _wait_submit_enabled(page, btn, 6):
            reasons = _get_failed_requirement_reasons(target)
            if reasons:
                raise Exception("Validation failed: " + "; ".join(reasons))
            raise Exception("'Submit clip' stayed disabled after filling link and ticking agreement (link rejected or checkbox not registered)")
    human_wait(page, 400)


def process_submission(page, row_idx: int, campaign_name: str, video_link: str, is_same_campaign: bool = False, state: dict = None):
    """Automates submission for a single Google Sheet row on the v2 Content
    Rewards UI.

    `is_same_campaign`: True when this row's campaign is the same one the
    page is currently sitting on (set by the caller based on the previous
    row). Governs the recovery/resume behavior:
      - Same campaign + modal still open (previous row failed validation)
        -> replace the link in-place and resubmit, no navigation at all.
      - Same campaign + modal closed (previous row succeeded, or the modal
        got closed some other way) -> skip Discover/search, go straight to
        clicking "Submit clip" on the already-open campaign page.
      - Different campaign -> full Discover -> search -> campaign card flow
        (the caller is expected to have already re-navigated to the channel
        URL before calling this, since a different campaign always means
        starting over).

    `state`, if provided, gets state['campaign_reached']=True once we know
    we're on the right campaign's detail page, and state['form_reached']=True
    once the submission modal is confirmed open -- used by the caller to
    decide how to recover after a failure.
    """
    print(f"\n[Row {row_idx}] Starting submission process...")

    target = get_app_frame(page)

    # Check whether a submission modal is already open -- e.g. left over from
    # a previous row on this same campaign that failed validation.
    modal_already_open = False
    try:
        modal_already_open = _modal_anchor(target).is_visible(timeout=2000)
    except Exception:
        modal_already_open = False

    if is_same_campaign and modal_already_open:
        print(f"[Row {row_idx}] Same campaign & modal already open from previous row -- replacing link in-place.")
        if state is not None:
            state["campaign_reached"] = True
            state["form_reached"] = True
        _fill_submission_form(page, target, row_idx, video_link)
        _submit_for_approval(page, target, row_idx)
        return

    human_wait(page, 700)

    if is_same_campaign:
        print(f"[Row {row_idx}] Same campaign as previous row -- skipping Discover/search, going straight to 'Submit clip'.")
    else:
        # 1. Navigate: Discover -> search -> campaign card
        _find_and_open_campaign(page, target, row_idx, campaign_name)

    if state is not None:
        state["campaign_reached"] = True

    # 2. Click "Submit clip" on the campaign detail page
    print(f"[Row {row_idx}] Locating 'Submit clip' button...")
    submit_clip_btn = target.locator("button:has-text('Submit clip'):visible").first
    try:
        submit_clip_btn.wait_for(state="visible", timeout=20000)
    except Exception as e:
        raise Exception(f"'Submit clip' button not found on campaign page: {e}")
    human_wait(page, 400)
    submit_clip_btn.click()
    human_wait(page, 1500)

    # 3. Fill the modal (video link + agreement checkbox). The modal being
    # open at this point means the campaign page is in a known-good state for
    # this row, so mark form_reached before filling -- a failure partway
    # through filling shouldn't be treated as "we don't know what state the
    # page is in".
    if state is not None:
        state["form_reached"] = True
    _fill_submission_form(page, target, row_idx, video_link)

    # 4. Submit and verify
    _submit_for_approval(page, target, row_idx)


def _find_got_it_button(page, target):
    """Locates the post-submission confirmation button. It used to say
    'Got it!' and now says 'Done'; both are matched, as the whole button label
    only (so longer unrelated button names don't count). Checks inside the app
    frame AND on the top-level page, since some Whop dialogs render via a
    portal attached to the top document. Returns the first visible match, or
    None."""
    name_pattern = re.compile(r"^\s*(got it!?|done!?)\s*$", re.IGNORECASE)
    candidates = []
    try:
        candidates.append(target.get_by_role("button", name=name_pattern).first)
    except Exception:
        pass
    try:
        candidates.append(page.get_by_role("button", name=name_pattern).first)
    except Exception:
        pass
    for candidate in candidates:
        try:
            if candidate.is_visible():
                return candidate
        except Exception:
            continue
    return None


def _dismiss_success_confirmation(page, target, row_idx: int):
    """After a successful submission a confirmation dialog opens with a 'Done'
    button (formerly 'Got it!'). It MUST be clicked: until it's dismissed the
    modal's 'Submit clip' button stays disabled for the next video. Clicks it
    and confirms it actually went away, retrying the click a few times."""
    for attempt in range(1, 4):
        try:
            btn = _find_got_it_button(page, target)
        except Exception:
            btn = None
        if btn is None:
            if attempt == 1:
                print(f"[Row {row_idx}] No 'Done' confirmation showing, continuing.")
            return
        try:
            print(f"[Row {row_idx}] Clicking 'Done' confirmation (attempt {attempt}/3)...")
            human_wait(page, 600)
            btn.click()
        except Exception as e:
            print(f"[Row {row_idx}] Warning: 'Done' click failed: {e}")
        # Confirm it closed before moving on to the next row.
        end = time.time() + 5
        while time.time() < end:
            page.wait_for_timeout(400)
            if _find_got_it_button(page, target) is None:
                human_wait(page, 800)
                print(f"[Row {row_idx}] 'Done' confirmation dismissed.")
                return
    print(f"[Row {row_idx}] Warning: 'Done' confirmation still showing after 3 clicks -- next row may fail.")


def _submit_for_approval(page, target, row_idx: int, max_retries: int = 5):
    """Clicks the modal's 'Submit clip' button and watches what happens next.

    Outcomes:
      1. 'Done' confirmation appears (or the modal closes) -> success; the
         'Done' button is clicked so the next video can be submitted.
      2. A requirement dot turns red -> a real validation failure, raise.
      3. Neither -- button goes "Submit clip" -> "Submitting..." -> back to
         "Submit clip" with the modal still open and no red: silent failure,
         click again, up to max_retries times.
    """
    print(f"[Row {row_idx}] Locating modal 'Submit clip' button...")
    # Scoped to the modal (not the sticky "Submit clip" bar on the campaign
    # page behind it) by looking only at buttons after the modal's own text.
    modal_heading = _modal_anchor(target)
    submit_btn = _modal_submit_btn(target)
    try:
        submit_btn.wait_for(state="visible", timeout=10000)
    except Exception as e:
        raise Exception(f"Modal 'Submit clip' button not found: {e}")

    for attempt in range(1, max_retries + 1):
        # On retries only: a confirmation already showing means an earlier
        # click did go through -- treat as success instead of double-submitting.
        if attempt > 1 and _find_got_it_button(page, target) is not None:
            print(f"[Row {row_idx}] A success confirmation is already showing before this attempt -- treating as success.")
            _dismiss_success_confirmation(page, target, row_idx)
            return

        print(f"[Row {row_idx}] Clicking 'Submit clip' (attempt {attempt}/{max_retries})...")
        human_wait(page, 500)
        submit_btn.click()

        print(f"[Row {row_idx}] Watching submission (up to 30s)...")
        outcome = None  # "closed" | "red_error" | "reverted" | None (still submitting)
        start_wait_time = time.time()
        while time.time() - start_wait_time < 30:
            page.wait_for_timeout(random.randint(1200, 1800))

            # Success signal #1: the 'Done' confirmation is showing. Most
            # reliable -- the modal underneath can stay technically visible.
            if _find_got_it_button(page, target) is not None:
                outcome = "closed"
                break

            # Success signal #2: the modal disappeared outright.
            try:
                modal_open = modal_heading.is_visible()
            except Exception:
                modal_open = False
            if not modal_open:
                outcome = "closed"
                break

            # A real red error can appear at any point while still open.
            if _get_failed_requirement_reasons(target):
                outcome = "red_error"
                break

            # Button reverted to "Submit clip", modal still open, nothing red.
            try:
                btn_text = submit_btn.inner_text(timeout=1000).strip().lower()
                if btn_text == "submit clip":
                    outcome = "reverted"
                    break
            except Exception:
                pass

        if outcome == "closed":
            print(f"[Row {row_idx}] Submission completed successfully!")
            _dismiss_success_confirmation(page, target, row_idx)
            return

        if outcome == "red_error":
            print(f"[Row {row_idx}] Real validation error detected (red indicator).")
            raise Exception(_read_requirement_statuses(target, row_idx))

        # "reverted" or stuck for 30s: the button label can flip back a
        # moment BEFORE the 'Done' dialog renders, so wait and recheck before
        # retrying -- clicking again in that gap would double-submit.
        human_wait(page, 2500, variance=0.2)
        if _find_got_it_button(page, target) is not None:
            print(f"[Row {row_idx}] Found the success confirmation on recheck -- treating as success, not a retry.")
            _dismiss_success_confirmation(page, target, row_idx)
            return
        if _get_failed_requirement_reasons(target):
            raise Exception(_read_requirement_statuses(target, row_idx))
        print(f"[Row {row_idx}] No result yet -- retrying 'Submit clip' click.")

    raise Exception(
        f"Submission did not complete after {max_retries} retries "
        f"(kept reverting to 'Submit clip' / getting stuck on 'Submitting...' with no red error and no success)."
    )


def run_automation():
    """Main automated workflow execution."""
    print("====================================================")
    print("   Whop Submission Automation                       ")
    print("====================================================")
    
    # 1. Validate environment configuration
    try:
        config.validate_config()
    except ValueError as e:
        print(f"Configuration Error:\n{e}")
        sys.exit(1)
        
    # 2. Check auth cookies state
    if not config.AUTH_STATE_PATH.exists():
        print(f"Error: Authentication state file not found at: {config.AUTH_STATE_PATH}")
        print("Please run the script in login mode first: python main.py --login")
        sys.exit(1)
        
    # 3. Check Google Service Account JSON
    if not config.SERVICE_ACCOUNT_PATH.exists():
        print(f"Error: Service account credentials JSON not found at: {config.SERVICE_ACCOUNT_PATH}")
        sys.exit(1)
        
    # 4. Connect to Google Sheets
    print("Connecting to Google Sheets...")
    try:
        scope = ["https://spreadsheets.google.com/feeds", "https://www.googleapis.com/auth/drive"]
        creds = ServiceAccountCredentials.from_json_keyfile_name(str(config.SERVICE_ACCOUNT_PATH), scope)
        client = gspread.authorize(creds)
        spreadsheet = client.open_by_key(config.SPREADSHEET_ID)
        sheet = spreadsheet.worksheet("Submissions")
        all_rows = sheet.get_all_values()
    except gspread.WorksheetNotFound:
        print("Google Sheet Error: 'Submissions' worksheet not found in the spreadsheet.")
        sys.exit(1)
    except Exception as e:
        print(f"Google Sheet Connection Error: {e}")
        sys.exit(1)
        
    if len(all_rows) <= 1:
        print("Spreadsheet is empty or only contains headers. Exiting.")
        sys.exit(0)
        
    # Parse headers dynamically
    headers = [h.strip().lower() for h in all_rows[0]]
    
    def find_col_idx(names):
        for name in names:
            if name in headers:
                return headers.index(name)
        return -1
        
    # Video title is kept only for Discord alert messages -- the v2 submission
    # modal has no title field to fill. Demographics screenshot has no visible
    # field in the v2 modal either. Both are optional columns now.
    title_idx = find_col_idx(["video title", "title"])
    link_idx = find_col_idx(["yt short link", "video link", "link"])
    channel_idx = find_col_idx(["whop campaign channel link", "whop campain channel link", "channel link", "channel"])
    campaign_idx = find_col_idx(["campaign name", "campaign"])
    status_idx = find_col_idx(["submission status", "status"])
    error_idx = find_col_idx(["error details", "error message", "error"])
    
    # Validate required columns
    missing_cols = []
    if link_idx == -1: missing_cols.append("Link/YT Short Link")
    if channel_idx == -1: missing_cols.append("Channel Link")
    if campaign_idx == -1: missing_cols.append("Campaign Name")
    if status_idx == -1: missing_cols.append("Status/Submission Status")
    if error_idx == -1: missing_cols.append("Error Details")
    
    if missing_cols:
        print(f"Error: Missing required column headers in sheet: {', '.join(missing_cols)}")
        sys.exit(1)
        
    # Filter pending rows (index in sheet is row_idx + 1)
    pending_rows = []
    for idx, row in enumerate(all_rows[1:], start=1):
        status_val = row[status_idx].strip().lower() if status_idx < len(row) else ""
        if status_val in ("", "pending"):
            pending_rows.append((idx + 1, row))
            
    if not pending_rows:
        print("No pending rows found. Processing completed.")
        sys.exit(0)
        
    print(f"Found {len(pending_rows)} pending rows to process.")
    
    # 5. Initialize Browser
    print(f"Starting browser (Headless={config.HEADLESS})...")
    
    total_processed = 0
    successful = 0
    failed = 0
    failed_details = []
    
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=config.HEADLESS)
        # Load saved cookies/localStorage session state
        context = browser.new_context(storage_state=str(config.AUTH_STATE_PATH))
        page = context.new_page()
        
        # Validate that session cookies are still active
        print("Validating session cookies...")
        if not validate_session(page):
            print("Session expired or invalid! Please log in again using: python main.py --login")
            discord_logger.send_failure_alert(
                row_idx=0,
                campaign_name="N/A",
                video_title="N/A",
                error_message="Authentication session has expired. You must re-run login: python main.py --login"
            )
            browser.close()
            sys.exit(1)
            
        print("Authentication active. Starting submissions...")
        
        # Ensure debug directory exists for failure screenshots
        debug_dir = config.BASE_DIR / "debug"
        debug_dir.mkdir(exist_ok=True)
        
        # Track the campaign currently loaded on the page. Per-row decision:
        #   - same campaign as current_loaded_campaign -> skip channel
        #     navigation and Discover/search entirely; process_submission()
        #     resumes from wherever the page already is (open modal -> replace
        #     link in place; closed modal -> click "Submit clip" again).
        #   - different campaign -> always restart fresh from the channel URL,
        #     even if it's the same channel as before.
        current_loaded_campaign = None

        # Keep processing batches until a re-sync finds 0 pending rows.
        while True:
            if not pending_rows:
                print("No pending rows found. Stopping.")
                break

            print(f"\nProcessing batch of {len(pending_rows)} pending row(s)...")

            for sheet_row_num, row_data in pending_rows:
                # Map row details dynamically, safety checking index bounds
                video_title = row_data[title_idx].strip() if (title_idx != -1 and title_idx < len(row_data)) else ""
                video_link = row_data[link_idx].strip() if link_idx < len(row_data) else ""
                channel_link = row_data[channel_idx].strip() if channel_idx < len(row_data) else ""
                campaign_name = row_data[campaign_idx].strip() if campaign_idx < len(row_data) else ""
                
                total_processed += 1
                
                # Start timing and navigate
                try:
                    is_same_campaign = bool(campaign_name) and (campaign_name == current_loaded_campaign)

                    if not is_same_campaign:
                        print(f"[Row {sheet_row_num}] Different campaign (or first row) -- restarting from channel URL: {channel_link}...")
                        try:
                            page.goto(channel_link, wait_until="domcontentloaded", timeout=90000)
                        except Exception as nav_err:
                            print(f"[Row {sheet_row_num}] Warning: navigation wait timed out/failed: {nav_err}. Continuing anyway, page may still be usable.")
                        # Give the page a beat to settle before interacting, per
                        # the v2 flow (open link -> wait 5s -> click Discover).
                        human_wait(page, 5000, variance=0.15)
                        dismiss_onboarding_popups(page, sheet_row_num)
                        print(f"[Row {sheet_row_num}] Navigation complete.")
                    else:
                        print(f"[Row {sheet_row_num}] Same campaign '{campaign_name}' as previous row -- resuming in place, no navigation.")

                    row_state = {"campaign_reached": False, "form_reached": False}
                    process_submission(
                        page=page,
                        row_idx=sheet_row_num,
                        campaign_name=campaign_name,
                        video_link=video_link,
                        is_same_campaign=is_same_campaign,
                        state=row_state
                    )

                    # Success -- we're on this campaign's page with the modal
                    # closed, ready for the next row to resume from here.
                    current_loaded_campaign = campaign_name

                    # Update spreadsheet on success
                    sheet.update_cell(sheet_row_num, status_idx + 1, "Submitted")
                    if error_idx != -1:
                        sheet.update_cell(sheet_row_num, error_idx + 1, "")  # Clear error
                    successful += 1
                    
                except Exception as e:
                    import traceback
                    traceback.print_exc()
                    error_msg = str(e)
                    print(f"[Row {sheet_row_num}] Submission failed: {error_msg}")

                    # Only trust that we're still on this campaign's page if we
                    # actually confirmed reaching it during this attempt. If the
                    # failure happened before that (channel nav, popups,
                    # Discover/search), we don't know what's on screen -- force
                    # a full restart from the channel URL on the next row.
                    if row_state.get("campaign_reached"):
                        current_loaded_campaign = campaign_name
                    else:
                        current_loaded_campaign = None

                    # Take screenshot of page state on failure
                    screenshot_filename = f"fail_row_{sheet_row_num}.png"
                    screenshot_path_local = debug_dir / screenshot_filename
                    try:
                        page.screenshot(path=str(screenshot_path_local), timeout=10000)
                    except Exception as screenshot_err:
                        print(f"Could not save screenshot: {screenshot_err}")
                        screenshot_path_local = None
                        
                    # Update spreadsheet on failure
                    sheet.update_cell(sheet_row_num, status_idx + 1, "Failed")
                    if error_idx != -1:
                        sheet.update_cell(sheet_row_num, error_idx + 1, error_msg)
                    
                    failed += 1
                    failed_details.append((sheet_row_num, campaign_name, error_msg))
                    
                    # Send immediate alert to Discord
                    discord_logger.send_failure_alert(
                        row_idx=sheet_row_num,
                        campaign_name=campaign_name,
                        video_title=video_title,
                        error_message=error_msg,
                        screenshot_path=str(screenshot_path_local) if screenshot_path_local else None
                    )
                    
                # Randomized buffer between rows (bot-detection avoidance)
                time.sleep(random.uniform(1.8, 4.2))

            # Batch complete -- re-sync sheet to check for newly added rows.
            print("\nBatch complete. Re-syncing Google Sheet for new pending rows...")
            all_rows = sheet.get_all_values()
            pending_rows = [
                (i + 2, row)
                for i, row in enumerate(all_rows[1:])
                if status_idx < len(row) and row[status_idx].strip().lower() in ("", "pending")
            ]
            if pending_rows:
                print(f"Found {len(pending_rows)} new pending row(s). Processing next batch...")
            else:
                print("No new pending rows found after re-sync. All done!")
            
        # 6. Save updated cookies/storage state back to file (keep session fresh)
        print("Saving updated session cookies...")
        context.storage_state(path=str(config.AUTH_STATE_PATH))
        browser.close()
        
    # 7. Send final run summary to Discord
    print("Sending final run summary to Discord...")
    discord_logger.send_summary_report(
        total=total_processed,
        successful=successful,
        failed=failed,
        failed_details=failed_details
    )
    print("Automation processing run complete.")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Whop Clipping Campaign Submission Automator")
    parser.add_argument("--login", action="store_true", help="Launch headed browser to log in and save session cookies.")
    args = parser.parse_args()
    
    if args.login:
        run_login()
    else:
        run_automation()