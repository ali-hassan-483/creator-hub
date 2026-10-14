import os
import sys
import argparse
import time
from pathlib import Path
import gspread
from oauth2client.service_account import ServiceAccountCredentials
from playwright.sync_api import sync_playwright
import json
import subprocess
import tempfile
import config
import discord_logger

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

def run_open(start_url: str = "https://whop.com/hub/"):
    """Open Whop in a headed browser using the saved cookies (auth_state.json)
    so you can do tasks manually. Session is saved back when you finish."""
    print("====================================================")
    print("   Whop Open Mode (saved cookies, manual control)   ")
    print("====================================================")

    if not config.AUTH_STATE_PATH.exists():
        print(f"Error: Authentication state file not found at: {config.AUTH_STATE_PATH}")
        print("Please run login mode first: python main.py --login")
        sys.exit(1)

    def save_state(context):
        """Save cookies to a temp file first, then replace, so a failed/empty
        save can never wipe your working auth_state.json."""
        tmp_path = config.AUTH_STATE_PATH.with_suffix(".tmp")
        try:
            context.storage_state(path=str(tmp_path))
            import json
            with open(tmp_path, "r", encoding="utf-8") as f:
                state = json.load(f)
            if state.get("cookies"):
                os.replace(tmp_path, config.AUTH_STATE_PATH)
                return True
            tmp_path.unlink(missing_ok=True)
        except Exception:
            try:
                tmp_path.unlink(missing_ok=True)
            except Exception:
                pass
        return False

    # Attempt to open Whop using the new CDP launcher (node script).
    try:
        import subprocess, json, tempfile
        # Load saved cookies from auth state
        with open(config.AUTH_STATE_PATH, "r", encoding="utf-8") as f:
            state = json.load(f)
        cookies = state.get("cookies", [])
        payload = {
            "cookies": cookies,
            "targetUrl": start_url,
        }
        # Write temporary payload file
        with tempfile.NamedTemporaryFile(delete=False, suffix=".json", mode="w", encoding="utf-8") as tmp:
            json.dump(payload, tmp)
            tmp_path = tmp.name
        script_path = Path.cwd() / "tools" / "open-whop-incognito.js"
        print("Launching Whop via CDP launcher...")
        # Run the node script; wait for it to complete (user closes Chrome)
        subprocess.run(["node", str(script_path), tmp_path], check=True)
        # Cleanup payload file
        try:
            os.remove(tmp_path)
        except Exception:
            pass
        print("Whop window closed. Session should be saved via the launcher.")
        return
    except Exception as e:
        print(f"CDP launch failed ({e}), falling back to Playwright mode.")
        # Fallback to original Playwright implementation
        with sync_playwright() as p:
            # Always headed here, regardless of HEADLESS in .env -- you want to see it.
            browser = p.chromium.launch(headless=False, args=["--start-maximized"])
            context = browser.new_context(
                storage_state=str(config.AUTH_STATE_PATH),
                no_viewport=True,
            )
            page = context.new_page()

            print(f"Opening {start_url} with saved cookies...")
            try:
                page.goto(start_url, wait_until="domcontentloaded", timeout=90000)
            except Exception as e:
                print(f"Warning: navigation timed out/failed: {e}. Page may still be usable.")

            if "/login" in page.url:
                print("\nWarning: Session looks expired (redirected to login).")
                print("You can log in manually in this window -- the new session will be saved.")
            else:
                print("\nLogged in with saved cookies. The browser is yours now.")

            print("\nClose the browser window when you're done")
            print("(cookies are auto-saved every 30s and again on exit).")

            last_save = time.time()
            try:
                while True:
                    open_pages = [pg for pg in context.pages if not pg.is_closed()]
                    if not open_pages:
                        break
                    open_pages[0].wait_for_timeout(1000)
                    if time.time() - last_save > 30:
                        save_state(context)
                        last_save = time.time()
            except Exception:
                # Browser/context closed by the user -- normal way to exit.
                pass

            # Try one last save (works if the context is still alive, e.g. last tab closed).
            if save_state(context):
                print(f"Session cookies saved to: {config.AUTH_STATE_PATH}")
            else:
                print("Note: final save skipped (browser already closed). Last auto-save is kept.")

            try:
                browser.close()
            except Exception:
                pass

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

def _fill_submission_form(page, target, row_idx: int, video_title: str, video_link: str, screenshot_path: str, form_already_open: bool = False):
    """Clears and fills the submission form fields (title, link, screenshot, checkbox).
    Called both for fresh submissions and when re-using an already-open error form."""
    print(f"[Row {row_idx}] Locating form inputs inside modal dialog...")

    # Title Input — clear existing value then fill with new one
    title_input = target.locator("input[placeholder*='title']").or_(target.locator("input[placeholder*='Title']")).first
    try:
        title_input.wait_for(state="visible", timeout=5000)
    except Exception as e:
        print(f"[Row {row_idx}] Title input field wait_for failed/timed out: {e}")

    if not title_input.is_visible():
        raise Exception("Title input field not found in submission modal.")
    action = "Replacing" if form_already_open else "Filling"
    print(f"[Row {row_idx}] {action} title with: '{video_title}'...")
    title_input.click(click_count=3)   # select all existing text
    title_input.fill(video_title)

    # Link Input — clear existing value then fill with new one
    link_input = target.locator("input[placeholder*='tiktok.com']").or_(target.locator("input[placeholder*='youtube.com']")).or_(target.locator("input[placeholder*='Link']")).first
    try:
        link_input.wait_for(state="visible", timeout=5000)
    except Exception as e:
        print(f"[Row {row_idx}] Link input field wait_for failed/timed out: {e}")

    if not link_input.is_visible():
        raise Exception("Video link input field not found in submission modal.")
    print(f"[Row {row_idx}] {action} link with: '{video_link}'...")
    link_input.click(click_count=3)    # select all existing text
    link_input.fill(video_link)

    # Demographics Screenshot File Upload
    print(f"[Row {row_idx}] Checking if demographics screenshot is required...")
    has_demographics_field = target.locator("text='Audience Demographics Screenshot'").first.is_visible()
    if has_demographics_field:
        print(f"[Row {row_idx}] Demographics screenshot is required by this campaign.")
        if not screenshot_path:
            raise Exception("Demographics screenshot is required by the form, but no path was provided in the Google Sheet.")

        abs_screenshot_path = Path(screenshot_path)
        if not abs_screenshot_path.is_absolute():
            abs_screenshot_path = config.BASE_DIR / screenshot_path

        if not abs_screenshot_path.exists():
            fallback_path = config.BASE_DIR / "screenshots" / Path(screenshot_path).name
            if fallback_path.exists():
                print(f"[Row {row_idx}] Screenshot not found at primary path. Using fallback in screenshots folder: {fallback_path}")
                abs_screenshot_path = fallback_path
            else:
                raise Exception(f"Demographics screenshot file not found at: {abs_screenshot_path} or fallback: {fallback_path}")

        print(f"[Row {row_idx}] Uploading screenshot: {abs_screenshot_path}")
        file_input = target.locator("input[type='file']").first
        try:
            file_input.wait_for(state="attached", timeout=5000)
        except Exception as e:
            raise Exception(f"File input field for demographics screenshot was not found: {e}")
        file_input.set_input_files(str(abs_screenshot_path))
        page.wait_for_timeout(2000)
    else:
        print(f"[Row {row_idx}] Demographics screenshot not required.")

    # Agreement Checkbox
    print(f"[Row {row_idx}] Checking for agreement checkbox...")
    checkbox = target.locator("input[type='checkbox']").first
    if checkbox.count() > 0:
        print(f"[Row {row_idx}] Checking agreement checkbox (forcing)...")
        try:
            checkbox.check(force=True, timeout=5000)
            print(f"[Row {row_idx}] Checkbox checked successfully.")
        except Exception as check_err:
            print(f"[Row {row_idx}] Warning: Direct checkbox check failed: {check_err}. Trying label click...")
            try:
                label = target.locator("label[for='agreement']").first
                if label.is_visible():
                    label.click()
                else:
                    agreement_text = target.locator("text=I've read the submission requirements").first
                    if agreement_text.is_visible():
                        agreement_text.click()
                    else:
                        print(f"[Row {row_idx}] Warning: Agreement text not found, skipping check step.")
            except Exception as click_err:
                print(f"[Row {row_idx}] Warning: Fallback label click also failed: {click_err}. Proceeding anyway.")
    else:
        print(f"[Row {row_idx}] Warning: Agreement checkbox not found in DOM, skipping check step.")


def process_submission(page, row_idx: int, campaign_name: str, video_title: str, video_link: str, screenshot_path: str, subcampaign_name: str = "", check_popup: bool = True, campaign_already_open: bool = False, form_already_open: bool = False, state: dict = None):
    """Automates submission for a single Google Sheet row on Whop.
    `state`, if provided, gets state['form_reached']=True set the moment the
    submission form modal is confirmed open -- used by the caller to know
    whether a later failure still leaves the form open for the next row."""
    print(f"\n[Row {row_idx}] Starting submission process...")
    
    # If the form is already open (previous row failed with form still visible),
    # skip navigation/popup/campaign search/Submit Video click entirely.
    # Just determine the correct target frame and go straight to filling fields.
    if form_already_open:
        print(f"[Row {row_idx}] Form is already open from previous failed row -- skipping navigation, popup, campaign search, and Submit Video click.")
        app_frame = page.frame(name="active-app-container")
        if app_frame:
            target = app_frame
        else:
            target = page
            for frame in page.frames:
                frame_name = frame.name or ""
                frame_url = frame.url or ""
                if "active-app-container" in frame_name or "contentrewards" in frame_url:
                    target = frame
                    break
        if state is not None:
            state["form_reached"] = True
        # Jump straight to filling the form fields
        _fill_submission_form(page, target, row_idx, video_title, video_link, screenshot_path, form_already_open=True)
        # Submit for approval (this was previously missing -- the function returned
        # right after filling, so the modal sat there unfilled-and-unsubmitted, which
        # is why the *next* row would then try to click a stale/already-on-screen
        # "Submit Video" and time out).
        _submit_for_approval(page, target, row_idx)
        return

    # 1. Wait for page load state
    print(f"[Row {row_idx}] Waiting for page load state 'domcontentloaded' (up to 15s)...")
    page.wait_for_timeout(1000)
    try:
        page.wait_for_load_state("domcontentloaded", timeout=15000)
        print(f"[Row {row_idx}] Page loaded successfully (domcontentloaded).")
    except Exception as e:
        print(f"[Row {row_idx}] Warning: wait_for_load_state('domcontentloaded') timed out/failed: {e}. Continuing anyway.")
    
    # Wait for the community join overlay popup to appear (up to 30s) and dismiss it.
    # This popup only appears the first time a channel page is loaded, so we skip
    # this check entirely when we're submitting another video on an already-open page.
    if check_popup:
        print(f"[Row {row_idx}] Waiting for community join popup (up to 30s)...")
        dismissed = False
        start_time = time.time()
        while time.time() - start_time < 30:
            # 1. Try finding on the main page
            try:
                btn = page.locator("button[aria-label='Dismiss']").first
                if btn.is_visible():
                    print(f"[Row {row_idx}] Community join popup detected on main page. Dismissing...")
                    btn.click()
                    dismissed = True
                    break
            except Exception:
                pass
                
            # 2. Try finding inside any frame/iframe
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
            # Wait a moment for the overlay to fade out
            page.wait_for_timeout(1000)
        else:
            print(f"[Row {row_idx}] No community join popup appeared within 30s.")
    else:
        print(f"[Row {row_idx}] Skipping community join popup check (page already loaded for this channel).")

    # 2. Find and click the campaign card
    # Locate the campaign name by text matching
    # We will loop for up to 2 minutes (120s) to find the iframe and the campaign card.
    # If the previous row already submitted to this same campaign, the campaign page
    # is already open -- skip the search/click and go straight to "Submit Video".
    target = page

    if campaign_already_open:
        print(f"[Row {row_idx}] Same campaign as previous submission -- campaign page already open, skipping campaign card search/click.")
        # Still need to determine the correct target context (main page or iframe)
        app_frame = page.frame(name="active-app-container")
        if app_frame:
            target = app_frame
        else:
            for frame in page.frames:
                frame_name = frame.name or ""
                frame_url = frame.url or ""
                if "active-app-container" in frame_name or "contentrewards" in frame_url:
                    target = frame
                    break
    else:
        start_find_time = time.time()
        campaign_locator = None

        print(f"[Row {row_idx}] Locating campaign '{campaign_name}' (polling up to 2 mins)...")
        while time.time() - start_find_time < 120:
            try:
                # Determine target context: main page or active-app-container iframe
                app_frame = page.frame(name="active-app-container")
                if app_frame:
                    target = app_frame
                else:
                    # Fallback search for any iframe that could be the active-app-container
                    target = page
                    for frame in page.frames:
                        frame_name = frame.name or ""
                        frame_url = frame.url or ""
                        if "active-app-container" in frame_name or "contentrewards" in frame_url:
                            target = frame
                            break

                # Now try to locate the campaign card on the target context
                campaign_locator = target.get_by_text(campaign_name).first
                if campaign_locator.is_visible():
                    print(f"[Row {row_idx}] Campaign card '{campaign_name}' successfully located and is visible!")
                    break
            except Exception as poll_err:
                # Page/frame may still be loading or mid-navigation (detached frame,
                # execution context destroyed, etc.) -- this is expected early on,
                # so just keep polling instead of letting the loop die here.
                print(f"[Row {row_idx}] Campaign card not ready yet (page still loading?): {poll_err}")

            page.wait_for_timeout(2000)
        else:
            # If we exited the loop without finding it
            if not campaign_locator or not campaign_locator.is_visible():
                # Check if we are on a "Choose a campaign to join" page
                print(f"[Row {row_idx}] Campaign card not visible after 2 minutes. Checking for 'Choose a campaign to join' section...")
                try:
                    on_iframe_choose_page = target.get_by_text("Choose a campaign to join").first.is_visible()
                except Exception:
                    on_iframe_choose_page = False
                try:
                    on_main_choose_page = page.get_by_text("Choose a campaign to join").first.is_visible()
                except Exception:
                    on_main_choose_page = False

                if on_iframe_choose_page:
                    print(f"[Row {row_idx}] 'Choose a campaign to join' section detected inside iframe.")
                elif on_main_choose_page:
                    print(f"[Row {row_idx}] 'Choose a campaign to join' section detected on main page.")
                else:
                    raise Exception(f"Campaign '{campaign_name}' not visible on the channel page after 2 minutes.")
        
        print(f"[Row {row_idx}] Clicking campaign card...")
        campaign_locator.scroll_into_view_if_needed()
        campaign_locator.click()
        print(f"[Row {row_idx}] Campaign card clicked. Waiting 2s for page transition...")
        page.wait_for_timeout(2000)
    
    # 3. Locate and click "Submit Video" button
    print(f"[Row {row_idx}] Locating 'Submit Video' button...")
    submit_video_btn = target.locator("button:has-text('Submit Video')").or_(target.locator("text='Submit Video'")).first
    # When the campaign page was already open (previous row just submitted on the
    # same campaign), the modal-close animation / page re-render needs more time
    # to settle before this button becomes visible/stable again -- give it longer.
    submit_video_wait_ms = 20000 if campaign_already_open else 5000
    try:
        submit_video_btn.wait_for(state="visible", timeout=submit_video_wait_ms)
    except Exception as e:
        print(f"[Row {row_idx}] Submit Video button wait_for failed/timed out: {e}")
        
    if not submit_video_btn.is_visible():
        print(f"[Row {row_idx}] 'Submit Video' button not visible. Checking if we are already in the submission modal...")
        if not target.locator("text='Submission checklist'").first.is_visible():
            if subcampaign_name:
                print(f"[Row {row_idx}] 'Submit Video' button not found and not in modal. Attempting to select subcampaign '{subcampaign_name}'...")
                subcampaign_locator = target.get_by_text(subcampaign_name).first
                try:
                    subcampaign_locator.wait_for(state="visible", timeout=10000)
                    print(f"[Row {row_idx}] Subcampaign '{subcampaign_name}' is visible. Clicking it...")
                    subcampaign_locator.scroll_into_view_if_needed()
                    subcampaign_locator.click()
                    page.wait_for_timeout(2000)
                    
                    # Try finding the Submit Video button again after subcampaign click
                    print(f"[Row {row_idx}] Locating 'Submit Video' button in subcampaign page...")
                    submit_video_btn = target.locator("button:has-text('Submit Video')").or_(target.locator("text='Submit Video'")).first
                    try:
                        submit_video_btn.wait_for(state="visible", timeout=5000)
                    except Exception as e:
                        print(f"[Row {row_idx}] Submit Video button in subcampaign wait_for failed/timed out: {e}")
                        
                    if not submit_video_btn.is_visible():
                        raise Exception(f"Could not find 'Submit Video' button on the campaign page or subcampaign page '{subcampaign_name}'.")
                    else:
                        print(f"[Row {row_idx}] Clicking 'Submit Video' button inside subcampaign...")
                        submit_video_btn.scroll_into_view_if_needed()
                        submit_video_btn.click()
                        page.wait_for_timeout(2000)
                except Exception as e:
                    raise Exception(f"Failed to locate or click subcampaign '{subcampaign_name}' / click Submit Video button: {e}")
            else:
                raise Exception("Could not find 'Submit Video' button on the campaign page, and no subcampaign name was provided.")
    else:
        print(f"[Row {row_idx}] Clicking 'Submit Video' button...")
        submit_video_btn.scroll_into_view_if_needed()
        if campaign_already_open:
            page.wait_for_timeout(1500)
        submit_video_btn.click(timeout=15000)
        page.wait_for_timeout(2000)
    
    # 4. Fill submission form inside the modal dialog
    # Mark form_reached BEFORE filling: the modal is already open at this point
    # (Submit Video was just clicked successfully), so even if filling fails
    # partway through (e.g. missing screenshot file), the campaign page is
    # still genuinely open for the next row -- don't lose that state.
    if state is not None:
        state["form_reached"] = True
    _fill_submission_form(page, target, row_idx, video_title, video_link, screenshot_path, form_already_open=False)

    # 5/6. Submit for approval and verify
    _submit_for_approval(page, target, row_idx)

def _submit_for_approval(page, target, row_idx: int):
    """Clicks 'Submit for approval' and verifies the submission went through.
    Raises an Exception on failure (validation error, button not found, or
    modal still open after waiting). Used by both the fresh-form flow and the
    form-already-open (retry-on-same-campaign) flow."""
    print(f"[Row {row_idx}] Locating 'Submit for approval' button...")
    submit_btn = target.locator("button:has-text('Submit for approval')").or_(target.locator("text='Submit for approval'")).first
    try:
        submit_btn.wait_for(state="visible", timeout=10000)
    except Exception as e:
        print(f"[Row {row_idx}] Submit for approval button wait_for failed/timed out: {e}")
    if not submit_btn.is_visible():
        raise Exception("Submit for approval button not found.")

    print(f"[Row {row_idx}] Clicking 'Submit for approval'...")
    submit_btn.click()

    # Verify submission went through (modal closes or button disappears)
    print(f"[Row {row_idx}] Waiting 10s for submission to process...")
    page.wait_for_timeout(10000)

    # Check if the modal/button is still visible
    submit_btn = target.locator("button:has-text('Submit for approval')").or_(target.locator("text='Submit for approval'")).first
    checklist_title = target.locator("text='Submission checklist'").first

    if submit_btn.is_visible() or checklist_title.is_visible():
        print(f"[Row {row_idx}] Submission modal is still open. Checking for error messages...")

        # Collect visible error texts (usually styled in rose/red)
        error_elements = target.locator(".text-rose-400, .text-rose-300").all()
        error_texts = []
        for el in error_elements:
            try:
                if el.is_visible():
                    txt = el.text_content().strip()
                    if txt and txt not in error_texts:
                        error_texts.append(txt)
            except Exception:
                pass

        if error_texts:
            err_msg = " | ".join(error_texts)
            raise Exception(f"Form submission error: {err_msg}")
        else:
            raise Exception("Submission popup is still open after 10s, possibly due to an unhandled validation error or slow connection.")
    else:
        print(f"[Row {row_idx}] Submission completed successfully! (Popup closed)")

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
        
    title_idx = find_col_idx(["video title", "title"])
    link_idx = find_col_idx(["yt short link", "video link", "link"])
    channel_idx = find_col_idx(["whop campaign channel link", "whop campain channel link", "channel link", "channel"])
    campaign_idx = find_col_idx(["campaign name", "campaign"])
    screenshot_idx = find_col_idx(["demographics screenshot path", "demographic screenshot path", "demographics screenshot", "screenshot"])
    status_idx = find_col_idx(["submission status", "status"])
    error_idx = find_col_idx(["error details", "error message", "error"])
    subcampaign_idx = find_col_idx(["subcampaign", "sub-campaign"])
    
    # Validate required columns
    missing_cols = []
    if title_idx == -1: missing_cols.append("Title/Video Title")
    if link_idx == -1: missing_cols.append("Link/YT Short Link")
    if channel_idx == -1: missing_cols.append("Channel Link")
    if campaign_idx == -1: missing_cols.append("Campaign Name")
    if screenshot_idx == -1: missing_cols.append("Demographics Screenshot Path")
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
        
        # Track which channel link is currently loaded so we don't re-navigate
        # for every row -- only when the link actually changes or after a failure.
        current_loaded_link = None
        # Track which campaign is currently open on the page, so we don't re-search/
        # re-click the campaign card for consecutive rows on the same campaign --
        # even if the previous row's submission failed.
        current_loaded_campaign = None
        # Track whether the submission form is still open from a previous failed row.
        # When True AND the next row shares the same campaign, we skip all navigation
        # and just replace the form fields in-place.
        form_is_open_from_error = False

        # Keep processing batches until a re-sync finds 0 pending rows.
        while True:
            if not pending_rows:
                print("No pending rows found. Stopping.")
                break

            print(f"\nProcessing batch of {len(pending_rows)} pending row(s)...")

            for sheet_row_num, row_data in pending_rows:
                # Map row details dynamically, safety checking index bounds
                video_title = row_data[title_idx].strip() if title_idx < len(row_data) else ""
                video_link = row_data[link_idx].strip() if link_idx < len(row_data) else ""
                channel_link = row_data[channel_idx].strip() if channel_idx < len(row_data) else ""
                campaign_name = row_data[campaign_idx].strip() if campaign_idx < len(row_data) else ""
                screenshot_path = row_data[screenshot_idx].strip() if (screenshot_idx != -1 and screenshot_idx < len(row_data)) else ""
                subcampaign_name = row_data[subcampaign_idx].strip() if (subcampaign_idx != -1 and subcampaign_idx < len(row_data)) else ""
                
                total_processed += 1
                
                # Start timing and navigate
                try:
                    did_navigate = False

                    # Decide if we can reuse the already-open error form:
                    # only when the form is still open AND next row is on the same campaign.
                    use_open_form = form_is_open_from_error and (campaign_name == current_loaded_campaign) and bool(campaign_name)

                    if use_open_form:
                        print(f"[Row {sheet_row_num}] Previous row failed with form still open and same campaign '{campaign_name}' -- will replace form fields in-place.")
                    elif channel_link != current_loaded_link:
                        print(f"[Row {sheet_row_num}] Navigating to channel URL: {channel_link}...")
                        try:
                            page.goto(channel_link, wait_until="domcontentloaded", timeout=90000)
                        except Exception as nav_err:
                            print(f"[Row {sheet_row_num}] Warning: navigation wait timed out/failed: {nav_err}. Continuing anyway, page may still be usable.")
                        print(f"[Row {sheet_row_num}] Navigation complete.")
                        current_loaded_link = channel_link
                        did_navigate = True
                        current_loaded_campaign = None
                    else:
                        print(f"[Row {sheet_row_num}] Same channel link as previous row, skipping navigation. Reusing already-open page.")

                    campaign_already_open = (not did_navigate) and (not use_open_form) and (campaign_name == current_loaded_campaign) and bool(campaign_name)

                    row_state = {"form_reached": False}
                    process_submission(
                        page=page,
                        row_idx=sheet_row_num,
                        campaign_name=campaign_name,
                        video_title=video_title,
                        video_link=video_link,
                        screenshot_path=screenshot_path,
                        subcampaign_name=subcampaign_name,
                        check_popup=did_navigate,
                        campaign_already_open=campaign_already_open,
                        form_already_open=use_open_form,
                        state=row_state
                    )

                    # Submission succeeded -- form is closed, campaign page remains open.
                    current_loaded_campaign = campaign_name
                    form_is_open_from_error = False
                    
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

                    # Only treat the campaign/form as "still open" for the next row if the
                    # form modal was actually confirmed reached during this attempt. If the
                    # failure happened earlier (navigation, popup, campaign search), we don't
                    # actually know the campaign page loaded -- don't claim it did.
                    if row_state.get("form_reached"):
                        current_loaded_campaign = campaign_name
                        form_is_open_from_error = True
                    else:
                        current_loaded_campaign = None
                        form_is_open_from_error = False
                    
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
                    
                # Add short buffer between rows
                time.sleep(2)

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
    parser.add_argument("--open", action="store_true", help="Open Whop in a visible browser using saved cookies so you can work manually.")
    parser.add_argument("--url", default="https://whop.com/hub/", help="Start URL for --open mode (default: whop hub).")
    args = parser.parse_args()
    
    if args.login:
        run_login()
    elif args.open:
        run_open(args.url)
    else:
        run_automation()