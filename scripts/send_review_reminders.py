"""Daily job: email the team when a product's "review again" date has arrived.

Runs on GitHub Actions (.github/workflows/review-reminders.yml). Uses only the
Python standard library. Settings come from environment variables, which the
workflow fills from the repository's secrets:

  SUPABASE_SERVICE_KEY  Supabase secret key (Project Settings -> API Keys -> Secret keys)
  SMTP_USER             the Google Workspace address the emails are sent from
  SMTP_PASSWORD         a Google "app password" for that address (not the normal password)
  REMINDER_TO           comma-separated list of people to notify
  SUPABASE_URL, SITE_URL  optional; read from config.js when not set
  DRY_RUN=1             list what would be sent, send nothing
"""
import datetime as dt
import html
import json
import os
import re
import smtplib
import sys
import urllib.parse
import urllib.request
from email.message import EmailMessage

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IST = dt.timezone(dt.timedelta(hours=5, minutes=30))


def from_config(key):
    try:
        with open(os.path.join(ROOT, "config.js"), encoding="utf-8") as f:
            m = re.search(key + r'\s*:\s*"([^"]+)"', f.read())
            return m.group(1) if m else ""
    except OSError:
        return ""


SUPABASE_URL = (os.environ.get("SUPABASE_URL") or from_config("SUPABASE_URL")).rstrip("/")
SITE_URL = os.environ.get("SITE_URL") or from_config("SITE_URL")
KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")
SMTP_USER = os.environ.get("SMTP_USER", "")
SMTP_PASSWORD = os.environ.get("SMTP_PASSWORD", "").replace(" ", "")
TO = [a.strip() for a in os.environ.get("REMINDER_TO", "").replace(";", ",").split(",") if a.strip()]
DRY = os.environ.get("DRY_RUN") == "1"
TEST = os.environ.get("SEND_TEST") == "1"   # send one sample email, touch nothing in the database


def api(method, path, body=None):
    headers = {"apikey": KEY, "Content-Type": "application/json", "Prefer": "return=minimal"}
    if KEY.startswith("eyJ"):  # legacy service_role JWT
        headers["Authorization"] = "Bearer " + KEY
    req = urllib.request.Request(SUPABASE_URL + "/rest/v1/" + path, method=method, headers=headers,
                                 data=json.dumps(body).encode() if body is not None else None)
    with urllib.request.urlopen(req, timeout=30) as r:
        raw = r.read()
        return json.loads(raw) if raw else None


def fmt(d):
    return dt.date.fromisoformat(d).strftime("%d %b %Y") if d else "—"


def structure(p):
    if p.get("vehicle") == "AIF":
        return "AIF " + (p.get("aif_category") or "")
    return p.get("vehicle") or p.get("category") or "—"


def build(p):
    months = p.get("review_months") or 0
    gap = f"{months} month{'s' if months != 1 else ''}"
    decision = {"accepted": "Accepted", "rejected": "Rejected", "review": "In review"}.get(p["decision"], p["decision"])
    link = f"{SITE_URL.rstrip('/')}/#{p['id']}" if SITE_URL else ""
    subject = f"Time to review {p['name']} again ({gap} gap)"
    rows = [("Fund house / manager", p.get("manager")), ("Type", " · ".join(x for x in [p.get("asset_class"), structure(p)] if x)),
            ("Decision", decision), ("Decision date", fmt(p.get("decided_on"))),
            ("Fund owner / analyst", p.get("analyst") or "—"), ("Review gap", gap), ("Review due", fmt(p.get("review_due")))]
    reason = (p.get("rationale") or "").strip()
    if len(reason) > 600:
        reason = reason[:600].rsplit(" ", 1)[0] + "…"

    text = (f"It's time for us to review {p['name']} again.\n\n"
            f"The team asked for a review {gap} after it was last looked at. The time gap was {gap}.\n\n"
            + "\n".join(f"{k}: {v}" for k, v in rows)
            + (f"\n\nWhy we decided:\n{reason}" if reason else "")
            + (f"\n\nOpen it in the library: {link}" if link else "")
            + "\n\n— Guardian Product Library")

    e = html.escape
    table = "".join(f'<tr><td style="padding:6px 14px 6px 0;color:#66716B;font-size:13px;white-space:nowrap">{e(k)}</td>'
                    f'<td style="padding:6px 0;font-size:14px;color:#17231E;font-weight:600">{e(str(v))}</td></tr>' for k, v in rows)
    body_html = f"""<div style="background:#F5F2EA;padding:24px 12px;font-family:Segoe UI,Arial,sans-serif">
<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #E5DFD0">
<div style="background:#0D2B23;padding:18px 24px;color:#E8CD7E;font-family:Georgia,serif;letter-spacing:.08em;font-size:15px;text-transform:uppercase">Guardian Product Library</div>
<div style="padding:24px">
<p style="margin:0 0 6px;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#9A6C0E;font-weight:700">Review due</p>
<h1 style="margin:0 0 12px;font-family:Georgia,serif;font-size:24px;color:#17231E">{e(p['name'])}</h1>
<p style="margin:0 0 18px;font-size:15px;color:#17231E;line-height:1.55">It's time for us to review this product again. The time gap was <b>{e(gap)}</b>.</p>
<table style="border-collapse:collapse;margin-bottom:18px">{table}</table>
{f'<p style="margin:0 0 6px;font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:#66716B;font-weight:700">Why we decided</p><p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#17231E;background:#F0ECE1;padding:12px 14px;border-radius:8px;border-left:3px solid #C9A44A;white-space:pre-wrap">{e(reason)}</p>' if reason else ''}
{f'<a href="{e(link)}" style="display:inline-block;background:#C9A44A;color:#1B1406;text-decoration:none;font-weight:700;padding:11px 20px;border-radius:8px">Open in the library</a>' if link else ''}
</div></div>
<p style="text-align:center;color:#8A938E;font-size:12px;margin:14px 0 0">Sent automatically by Guardian Product Library. To stop these reminders, edit the product and set "Review again?" to No.</p>
</div>"""
    return subject, text, body_html


def main():
    missing = [n for n, v in [("SUPABASE_URL", SUPABASE_URL), ("SUPABASE_SERVICE_KEY", KEY)] if not v]
    if not DRY or TEST:
        missing +=[n for n, v in [("SMTP_USER", SMTP_USER), ("SMTP_PASSWORD", SMTP_PASSWORD), ("REMINDER_TO", TO)] if not v]
    if missing:
        sys.exit("Missing settings: " + ", ".join(missing) + ". Add them under GitHub → Settings → Secrets and variables → Actions.")

    today = dt.datetime.now(IST).date().isoformat()
    cols = "id,name,manager,category,asset_class,vehicle,aif_category,analyst,decision,decided_on,rationale,review_months,review_due"
    q = f"products?select={cols}&review_again=eq.true&reminder_sent_at=is.null&review_due=lte.{today}&order=review_due.asc"
    due = api("GET", q) or []
    total = api("GET", "products?select=id&review_again=eq.true") or []
    print(f"{today}: database reached; {len(total)} product(s) have a review scheduled, {len(due)} due now")

    if TEST:
        sample = {"id": "", "name": "TEST — Example Multi-Cap PMS", "manager": "Example Capital", "asset_class": "Equity",
                  "vehicle": "PMS", "analyst": "Test", "decision": "accepted", "decided_on": today,
                  "rationale": "This is a test email from Guardian Product Library. If you received it, review reminders are set up correctly.",
                  "review_months": 6, "review_due": today}
        subject, text, body_html = build(sample)
        subject = "[Test] " + subject
        msg = EmailMessage()
        msg["Subject"], msg["From"], msg["To"] = subject, f"Guardian Product Library <{SMTP_USER}>", ", ".join(TO)
        msg.set_content(text)
        msg.add_alternative(body_html, subtype="html")
        with smtplib.SMTP_SSL("smtp.gmail.com", 465, timeout=30) as s:
            s.login(SMTP_USER, SMTP_PASSWORD)
            s.send_message(msg)
        print(f"Test email sent to {len(TO)} recipient(s).")
        return

    if not due:
        return

    smtp = None
    if not DRY:
        smtp = smtplib.SMTP_SSL("smtp.gmail.com", 465, timeout=30)
        try:
            smtp.login(SMTP_USER, SMTP_PASSWORD)
        except smtplib.SMTPAuthenticationError:
            sys.exit("Gmail refused the sign-in. Check SMTP_USER and that SMTP_PASSWORD is an app password.")
    failures = 0
    for p in due:
        subject, text, body_html = build(p)
        if DRY:
            print(f"  would send: {subject}  (due {p['review_due']}) to {len(TO)} recipient(s)")
            continue
        msg = EmailMessage()
        msg["Subject"], msg["From"], msg["To"] = subject, f"Guardian Product Library <{SMTP_USER}>", ", ".join(TO)
        msg.set_content(text)
        msg.add_alternative(body_html, subtype="html")
        try:
            smtp.send_message(msg)
            api("PATCH", "products?id=eq." + urllib.parse.quote(p["id"]),
                {"reminder_sent_at": dt.datetime.now(dt.timezone.utc).isoformat()})
            print(f"  sent: {subject}")
        except Exception as ex:  # keep going; an unsent one is retried tomorrow
            failures += 1
            print(f"  FAILED: {subject}: {ex}")
    if smtp:
        smtp.quit()
    if failures:
        sys.exit(f"{failures} reminder(s) failed; they will be retried on the next run.")


if __name__ == "__main__":
    main()
