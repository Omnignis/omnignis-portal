#!/usr/bin/env python3
"""
Omnignis church livestream report generator.

Runs on a schedule (GitHub Actions, daily). For every church whose report is
"due" today (daily / weekly = Sunday / monthly = 1st), it:
  1. decrypts that church's Facebook page token,
  2. pulls the videos since the last report,
  3. reads total views + unique viewers for each,
  4. builds a formatted Excel workbook,
  5. emails it to the church's destination address(es) via Resend,
  6. records the run time.

NOTE ON FACEBOOK METRICS: Facebook's Graph API changes over time. The metric
names and edges below (video_insights: total_video_views, total_video_views_unique)
are correct as of the current API but should be verified against a real page
during your first test run, and adjusted here if Facebook returns an error.
"""

import os
import io
import re
import base64
import hmac
import hashlib
from datetime import datetime, timedelta, timezone, time as dtime
from zoneinfo import ZoneInfo

import requests
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

import formats
import snapshots

SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
SERVICE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
ENC_KEY = base64.b64decode(os.environ["TOKEN_ENCRYPTION_KEY"])
APP_SECRET = os.environ.get("FACEBOOK_APP_SECRET", "")
GRAPH_VERSION = os.environ.get("GRAPH_API_VERSION", "v21.0")
RESEND_API_KEY = os.environ["RESEND_API_KEY"]
FROM_EMAIL = os.environ.get("REPORT_FROM_EMAIL", "reports@send.omnignis.com")

# On-demand runs. The portal triggers this workflow with a single profile id via
# workflow_dispatch; an empty value means the normal scheduled sweep.
ONLY_PROFILE_ID = os.environ.get("ONLY_PROFILE_ID", "").strip()
REPORT_MODE = (os.environ.get("REPORT_MODE") or "scheduled").strip().lower()
IS_MANUAL = bool(ONLY_PROFILE_ID)

GRAPH = f"https://graph.facebook.com/{GRAPH_VERSION}"
SB_HEADERS = {
    "apikey": SERVICE_KEY,
    "Authorization": f"Bearer {SERVICE_KEY}",
    "Content-Type": "application/json",
}

# Access tokens end up inside requests' exception messages because they travel
# as query parameters, and those messages get printed to CI logs. GitHub cannot
# mask them (they are decrypted at runtime, not repo secrets), so redact here.
_SECRET_PARAM_RE = re.compile(r"((?:access_token|appsecret_proof)=)[^&\s\"']+")


def redact(value) -> str:
    return _SECRET_PARAM_RE.sub(r"\1[REDACTED]", str(value))


# ----------------------- helpers -----------------------
def decrypt_token(b64: str) -> str:
    raw = base64.b64decode(b64)
    iv, ct_tag = raw[:12], raw[12:]          # matches lib/crypto.js layout
    return AESGCM(ENC_KEY).decrypt(iv, ct_tag, None).decode("utf-8")


def appsecret_proof(token: str) -> str:
    if not APP_SECRET:
        return ""
    return hmac.new(APP_SECRET.encode(), token.encode(), hashlib.sha256).hexdigest()


def sb_get(table: str, params: str = "") -> list:
    r = requests.get(f"{SUPABASE_URL}/rest/v1/{table}?{params}", headers=SB_HEADERS, timeout=30)
    r.raise_for_status()
    return r.json()


def sb_patch(table: str, match: str, body: dict) -> None:
    r = requests.patch(f"{SUPABASE_URL}/rest/v1/{table}?{match}", headers=SB_HEADERS, json=body, timeout=30)
    r.raise_for_status()


DEFAULT_TZ = "America/Chicago"
DEFAULT_SEND_HOUR = 13          # 1pm local
DEFAULT_SEND_WEEKDAY = 6        # Sunday (Mon=0 .. Sun=6)


def tz_for(p: dict) -> ZoneInfo:
    """A church's timezone, falling back rather than crashing the whole run."""
    name = (p.get("timezone") or "").strip() or DEFAULT_TZ
    try:
        return ZoneInfo(name)
    except Exception:
        print(f"WARNING: unknown timezone {name!r}, falling back to {DEFAULT_TZ}")
        return ZoneInfo(DEFAULT_TZ)


def period_anchor(local_date, frequency: str, send_weekday: int):
    """The date the current reporting period is keyed to, in local time."""
    if frequency == "weekly":
        return local_date - timedelta(days=(local_date.weekday() - send_weekday) % 7)
    if frequency == "monthly":
        return local_date.replace(day=1)
    return local_date                      # daily


def due_at(p: dict, tz: ZoneInfo):
    """The local datetime this church's current report was scheduled for."""
    frequency = p.get("report_frequency") or "weekly"
    hour = int(p.get("send_hour") if p.get("send_hour") is not None else DEFAULT_SEND_HOUR)
    weekday = int(p.get("send_weekday") if p.get("send_weekday") is not None else DEFAULT_SEND_WEEKDAY)
    anchor = period_anchor(datetime.now(tz).date(), frequency, weekday)
    # fold=0 picks the first instance of an ambiguous local hour when DST ends.
    return datetime.combine(anchor, dtime(hour=hour, fold=0), tzinfo=tz)


def is_due(p: dict, tz: ZoneInfo) -> bool:
    """
    True when this church's scheduled moment has passed and we have not already
    sent for that moment.

    Checking "have we sent since the scheduled time" rather than "is it exactly
    that hour" means a delayed or skipped run still catches up on the next
    hourly pass, and a run that fires twice cannot double-send.
    """
    scheduled = due_at(p, tz)
    if datetime.now(tz) < scheduled:
        return False
    last = p.get("last_report_at")
    if last:
        try:
            last_dt = datetime.fromisoformat(last.replace("Z", "+00:00"))
            if last_dt >= scheduled:
                return False
        except ValueError:
            pass                            # unparseable, treat as never sent
    return True


def lookback_days(frequency: str) -> int:
    return {"daily": 2, "weekly": 8, "monthly": 32}.get(frequency, 8)


def local_date_str(created_time: str, tz: ZoneInfo) -> str:
    """
    Facebook returns UTC like 2026-08-16T23:30:00+0000. Slicing the first ten
    characters dated a Sunday evening service as Monday for every church west
    of Greenwich, which is most of them.
    """
    if not created_time:
        return ""
    raw = created_time.strip()
    for fmt in ("%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%dT%H:%M:%S.%f%z"):
        try:
            return datetime.strptime(raw, fmt).astimezone(tz).strftime("%Y-%m-%d")
        except ValueError:
            continue
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00")).astimezone(tz).strftime("%Y-%m-%d")
    except ValueError:
        return raw[:10]                     # last resort, previous behaviour


def filter_livestreams(videos: list) -> list:
    """
    Keep only broadcasts that were actually live.

    live_status is present on videos that were streamed. If NO video in the
    batch carries the field, Graph is not returning it for this page, and
    filtering would produce an empty report. In that case keep everything and
    say so loudly, because inflated numbers are better caught by a human than
    an empty attachment.
    """
    if not videos:
        return []
    live = [v for v in videos if v.get("live_status")]
    if live:
        skipped = len(videos) - len(live)
        if skipped:
            print(f"   filtered out {skipped} non-livestream video(s)")
        return live
    print("   WARNING: Graph returned no live_status on any video for this page. "
          "Including all videos, which may overstate attendance. Verify this page's data.")
    return videos


def latest_livestream_only(videos: list) -> list:
    """Narrow a video list down to the single most recent livestream.

    live_status is present on videos that were broadcast live (LIVE,
    LIVE_STOPPED, VOD). If Graph does not return the field at all, we cannot
    tell a livestream from an uploaded clip, so we fall back to the newest
    video rather than sending an empty report.
    """
    if not videos:
        return []
    live = [v for v in videos if v.get("live_status")]
    pool = live or videos
    pool = sorted(pool, key=lambda v: v.get("created_time", ""), reverse=True)
    return pool[:1]


# ----------------------- facebook -----------------------
def fetch_videos(page_id: str, token: str, since_dt: datetime) -> list:
    proof = appsecret_proof(token)
    params = {
        "access_token": token,
        "fields": "id,title,description,created_time,live_status",
        "since": int(since_dt.timestamp()),
        "limit": 50,
    }
    if proof:
        params["appsecret_proof"] = proof
    videos, url = [], f"{GRAPH}/{page_id}/videos"
    while url and len(videos) < 200:
        r = requests.get(url, params=params, timeout=30)
        data = r.json()
        if "error" in data:
            raise RuntimeError(f"Graph videos error: {data['error'].get('message')}")
        videos.extend(data.get("data", []))
        url = data.get("paging", {}).get("next")
        params = None                     # "next" URLs already carry the query string
    return videos


# Only thresholds Facebook actually publishes. There is no 5 or 10 minute
# metric on video_insights: the ladder stops at 60 seconds.
CORE_METRICS = ["total_video_views", "total_video_views_unique"]
EXTRA_METRICS = ["total_video_10s_views", "total_video_60s_excludes_shorter_views"]

METRIC_KEY = {
    "total_video_views": "total_views",
    "total_video_views_unique": "unique_viewers",
    "total_video_10s_views": "sec10_viewers",
    "total_video_60s_excludes_shorter_views": "min1_viewers",
}

_metrics_degraded = False        # set once if Graph rejects the extended set


def _read_insights(video_id: str, token: str, metrics: list) -> dict:
    proof = appsecret_proof(token)
    params = {"access_token": token, "metric": ",".join(metrics)}
    if proof:
        params["appsecret_proof"] = proof
    r = requests.get(f"{GRAPH}/{video_id}/video_insights", params=params, timeout=30)
    return r.json()


def fetch_metrics(video_id: str, token: str) -> dict:
    """
    Read the viewer counts for one video.

    Every video_insights metric is a LIFETIME total. There is no period or
    since/until, so this is "as of right now", not "during the report window".
    Day-of and week-after figures come from differencing daily snapshots.
    """
    global _metrics_degraded

    wanted = CORE_METRICS if _metrics_degraded else CORE_METRICS + EXTRA_METRICS
    data = _read_insights(video_id, token, wanted)

    # If Graph rejects one of the extended names (they do get retired), fall back
    # to the two we cannot do without rather than failing the whole church.
    if "error" in data and not _metrics_degraded:
        msg = data["error"].get("message", "")
        print(f"   note: extended metrics rejected ({msg}). "
              f"Falling back to {', '.join(CORE_METRICS)} for the rest of this run.")
        _metrics_degraded = True
        data = _read_insights(video_id, token, CORE_METRICS)

    if "error" in data:
        raise RuntimeError(f"Graph insights error: {data['error'].get('message')}")

    out = {"total_views": 0, "unique_viewers": 0, "sec10_viewers": None, "min1_viewers": None}
    for item in data.get("data", []):
        key = METRIC_KEY.get(item.get("name"))
        if not key:
            continue
        try:
            out[key] = item["values"][0]["value"]
        except (KeyError, IndexError, TypeError):
            pass
    return out


def sb_post(table, rows, on_conflict=None):
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    if on_conflict:
        url += f"?on_conflict={on_conflict}"
    headers = dict(SB_HEADERS)
    # merge-duplicates makes the unique index idempotent, so a second run in the
    # same local day updates instead of erroring.
    headers["Prefer"] = "resolution=merge-duplicates,return=minimal"
    r = requests.post(url, headers=headers, json=rows, timeout=30)
    r.raise_for_status()


def capture_snapshots(p, conn, token, tz):
    """Record today's running totals for recent livestreams. Once per local day."""
    local_now = datetime.now(tz)
    if local_now.hour < snapshots.SNAPSHOT_HOUR:
        return 0
    today_local = local_now.date()
    already = sb_get(
        "livestream_snapshots",
        f"select=local_date&profile_id=eq.{p['id']}&local_date=eq.{today_local}&limit=1")
    if already:
        return 0

    since = local_now - timedelta(days=snapshots.SNAPSHOT_WINDOW_DAYS)
    videos = filter_livestreams(fetch_videos(conn["page_id"], token, since))
    rows = []
    for vid in videos:
        m = fetch_metrics(vid["id"], token)
        rows.append({
            "profile_id": p["id"],
            "video_id": vid["id"],
            "service_date": local_date_str(vid.get("created_time", ""), tz) or None,
            "local_date": str(today_local),
            "total_views": m["total_views"],
            "unique_viewers": m["unique_viewers"],
            "sec10_viewers": m["sec10_viewers"],
            "min1_viewers": m["min1_viewers"],
        })
    if rows:
        sb_post("livestream_snapshots", rows,
                on_conflict="profile_id,video_id,local_date")
    return len(rows)


def load_snapshots(profile_id, since_date):
    """All snapshots for a church since a date, grouped by video id."""
    rows = sb_get(
        "livestream_snapshots",
        f"select=video_id,local_date,total_views,unique_viewers,sec10_viewers,min1_viewers"
        f"&profile_id=eq.{profile_id}&local_date=gte.{since_date}&order=local_date.asc")
    grouped = {}
    for r in rows:
        grouped.setdefault(r["video_id"], []).append(r)
    return grouped


# ----------------------- email -----------------------
def send_email(to_list: list, subject: str, html: str, attachments: list) -> None:
    """attachments: [(filename, bytes), ...] so a church can receive several formats."""
    payload = {
        "from": f"Omnignis Reports <{FROM_EMAIL}>",
        "to": to_list,
        "subject": subject,
        "html": html,
        "attachments": [
            {"filename": name, "content": base64.b64encode(data).decode()}
            for name, data in attachments
        ],
    }
    r = requests.post(
        "https://api.resend.com/emails",
        headers={"Authorization": f"Bearer {RESEND_API_KEY}", "Content-Type": "application/json"},
        json=payload, timeout=30,
    )
    if r.status_code >= 300:
        raise RuntimeError(f"Resend error {r.status_code}: {r.text}")


# ----------------------- main -----------------------
def main():
    today = datetime.now(timezone.utc)
    profiles = sb_get("profiles", "select=id,church_name,destination_emails,report_frequency,last_report_at,timezone,send_hour,send_weekday,report_formats,custom_reporting,viewer_metrics")
    connections = {
        c["profile_id"]: c
        for c in sb_get("facebook_connections", "select=profile_id,page_id,page_name,token_ciphertext")
        if c.get("page_id") and c.get("token_ciphertext")   # skip half-finished connections
    }

    if IS_MANUAL:
        profiles = [p for p in profiles if p["id"] == ONLY_PROFILE_ID]
        if not profiles:
            print(f"No profile matched ONLY_PROFILE_ID={ONLY_PROFILE_ID}")
            raise SystemExit(1)
        print(f"Manual run for profile {ONLY_PROFILE_ID}, mode={REPORT_MODE}")

    processed = 0
    failed = 0
    for p in profiles:
        conn = connections.get(p["id"])
        if not conn:
            if IS_MANUAL:
                print("ERROR: that church has no completed Facebook connection")
                raise SystemExit(1)
            continue
        tz = tz_for(p)

        # Snapshots run on every hourly pass, independent of whether a report is
        # due. Miss a day and that day's split is gone for good.
        if not IS_MANUAL:
            try:
                token_for_snap = decrypt_token(conn["token_ciphertext"])
                n = capture_snapshots(p, conn, token_for_snap, tz)
                if n:
                    print(f"snapshot: {p.get('church_name')} captured {n} livestream(s)")
            except Exception as e:
                print(f"snapshot ERROR for {p.get('church_name')}: {redact(e)}")

        # A manual run is an explicit request, so the schedule does not apply.
        if not IS_MANUAL and not is_due(p, tz):
            continue

        try:
            token = decrypt_token(conn["token_ciphertext"])
            if REPORT_MODE == "latest":
                # Look back far enough to be sure of catching the last service,
                # then keep only the most recent livestream.
                since = today - timedelta(days=90)
            elif p.get("last_report_at"):
                since = datetime.fromisoformat(p["last_report_at"].replace("Z", "+00:00"))
            else:
                since = today - timedelta(days=lookback_days(p.get("report_frequency") or "weekly"))

            videos = fetch_videos(conn["page_id"], token, since)
            # Applies to scheduled runs too. Counting uploaded clips and promos
            # as attendance overstated the numbers churches report to a diocese.
            videos = filter_livestreams(videos)
            if REPORT_MODE == "latest":
                videos = latest_livestream_only(videos)
                if not videos:
                    print("ERROR: no livestreams found on that page in the last 90 days")
                    raise SystemExit(1)
            custom = bool(p.get("custom_reporting"))
            snaps = load_snapshots(p["id"], (today - timedelta(days=45)).date())

            rows = []
            for vid in videos:
                m = fetch_metrics(vid["id"], token)
                service_date = local_date_str(vid.get("created_time", ""), tz)
                b = snapshots.breakdown_for(vid["id"], service_date, snaps, m)
                rows.append({
                    "date": service_date,
                    "title": vid.get("title") or vid.get("description", "")[:60] or "Livestream",
                    "total_views": m["total_views"],
                    "unique_viewers": m["unique_viewers"],
                    "sec10_viewers": m["sec10_viewers"],
                    "min1_viewers": m["min1_viewers"],
                    # The requested split: the day itself, the whole week to the
                    # following Saturday, and what accrued in between.
                    "day_of": b["day_of"],
                    "through_saturday": b["through_saturday"],
                    "during_week": b["during_week"],
                    "window_end": b["window_end"],
                    "window_complete": b["complete"],
                })
            rows.sort(key=lambda r: r["date"] or "", reverse=True)

            if REPORT_MODE == "latest" and rows:
                period = rows[0]["date"]
            else:
                period = (f"{since.astimezone(tz).date()} to "
                          f"{datetime.now(tz).date()}")

            chosen = formats.parse_formats(p.get("report_formats"))
            columns = formats.parse_columns(p.get("viewer_metrics"), custom)
            attachments = formats.build_all(p["church_name"], rows, period, chosen, columns)
            recipients = [e.strip() for e in (p["destination_emails"] or "").split(",") if e.strip()]
            if not recipients:
                continue

            html = (
                f"<p>Hello {p['church_name']},</p>"
                f"<p>Attached is your livestream attendance report for <b>{period}</b> "
                f"({len(rows)} livestream{'s' if len(rows) != 1 else ''}).</p>"
                f"<p>Attached as: {', '.join(formats.LABEL[f] for f in chosen)}.</p>"
                f"<p>Omnignis Technologies</p>"
            )
            send_email(recipients, f"Livestream report: {p['church_name']}", html, attachments)

            # Only a scheduled run advances last_report_at. If a manual run moved
            # it, the next scheduled report would skip everything in between.
            if IS_MANUAL:
                sb_patch("profiles", f"id=eq.{p['id']}", {"last_manual_report_at": today.isoformat()})
            else:
                sb_patch("profiles", f"id=eq.{p['id']}", {"last_report_at": today.isoformat()})
            processed += 1
            print(f"OK: sent report to {p['church_name']} "
                  f"({len(rows)} livestream(s), formats: {','.join(chosen)}, tz: {tz})")
        except Exception as e:
            failed += 1
            print(f"ERROR for {p.get('church_name')}: {redact(e)}")

    print(f"Done. Reports sent: {processed}. Failures: {failed}.")
    if failed:
        # Exit non-zero so the scheduled workflow goes red and GitHub emails us.
        # Silent green runs hid months of expired-token failures.
        raise SystemExit(1)


if __name__ == "__main__":
    main()
