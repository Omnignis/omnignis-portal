#!/usr/bin/env python3
"""
Daily snapshots of livestream viewer totals.

WHY THIS EXISTS: every Facebook video_insights metric is a LIFETIME total.
There is no period and no since/until on them, so the API can never answer
"how many views happened on Sunday" versus "during the following week". It only
ever reports the running total as of the moment you ask.

So we ask once per local day and store the answer. Differencing two snapshots
gives the numbers churches actually want:

    day of service    = snapshot taken at the end of the service day
    through Saturday  = snapshot taken at the end of the following Saturday
    during the week   = the difference between them

This only works forward from the day capture begins. Past services cannot be
reconstructed.
"""

from datetime import datetime, timedelta

SNAPSHOT_HOUR = 23              # capture in the last hour of the local day
SNAPSHOT_WINDOW_DAYS = 10       # keep capturing a service through its week


def week_end_saturday(service_date):
    """
    The Saturday that closes this service's reporting week.

    The requirement was "the date of the service to the following Saturday".
    A Sunday service therefore covers Sunday through the next Saturday. A
    Saturday service reports on itself.
    """
    return service_date + timedelta(days=(5 - service_date.weekday()) % 7)


def snapshot_at_or_before(snaps, cutoff_date):
    """The newest snapshot taken on or before cutoff_date, or None."""
    best = None
    for s in snaps:
        try:
            d = datetime.strptime(s["local_date"], "%Y-%m-%d").date()
        except (ValueError, TypeError, KeyError):
            continue
        if d <= cutoff_date and (best is None or d > best[0]):
            best = (d, s)
    return best[1] if best else None


def breakdown_for(video_id, service_date_str, snaps_by_video, current):
    """
    Split one livestream's viewers into "on the day" and "during the week after".

    Either figure is None when snapshot history is too thin, so the report can
    say "collecting" rather than print a number we cannot stand behind.
    """
    out = {"day_of": None, "through_saturday": None, "during_week": None,
           "window_end": None, "complete": False}
    if not service_date_str:
        return out
    try:
        service_date = datetime.strptime(service_date_str, "%Y-%m-%d").date()
    except ValueError:
        return out

    end = week_end_saturday(service_date)
    out["window_end"] = str(end)
    snaps = snaps_by_video.get(video_id, [])

    day_snap = snapshot_at_or_before(snaps, service_date)
    if day_snap:
        out["day_of"] = day_snap.get("total_views")

    end_snap = snapshot_at_or_before(snaps, end)
    if end_snap:
        try:
            captured = datetime.strptime(end_snap["local_date"], "%Y-%m-%d").date()
        except (ValueError, TypeError, KeyError):
            captured = None
        # The window is only closed once we hold a snapshot from that Saturday
        # or later. Before then the total is still climbing.
        if captured and captured >= end:
            out["through_saturday"] = end_snap.get("total_views")
            out["complete"] = True

    if out["through_saturday"] is None:
        out["through_saturday"] = current.get("total_views")   # still open: best so far

    if out["day_of"] is not None and out["through_saturday"] is not None:
        out["during_week"] = max(0, out["through_saturday"] - out["day_of"])
    return out
