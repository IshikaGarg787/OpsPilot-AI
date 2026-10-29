"""Step 1: turn ticket-level data (issues.csv) into a daily ticket-count time series."""
from pathlib import Path
import pandas as pd

# Ticket types that represent real support workload.
# Types like Vacation, Epic, Sprint Summary, Retrospective are NOT workload.
SUPPORT_TYPES = ["Ticket", "Service", "HD Service"]


def load_issues(path):
    """Read issues.csv. Timestamps have mixed formats (some with fractional
    seconds), so format='ISO8601' is required."""
    df = pd.read_csv(path, usecols=["id", "issue_type", "issue_priority", "issue_created"])
    df["issue_created"] = pd.to_datetime(df["issue_created"], utc=True, format="ISO8601")
    return df.drop_duplicates(subset="id")


def build_daily_series(df, start="2018-01-01", end=None, types=SUPPORT_TYPES):
    """Count tickets created per calendar day (UTC).

    Days with no tickets are kept as 0 (full date range, no gaps), which
    forecasting models need.
    """
    d = df[df["issue_type"].isin(types)].copy()
    d["date"] = d["issue_created"].dt.tz_convert("UTC").dt.tz_localize(None).dt.normalize()
    daily = d.groupby("date").size()
    start = pd.Timestamp(start)
    end = pd.Timestamp(end) if end else daily.index.max()
    full_idx = pd.date_range(start, end, freq="D")
    daily = daily.reindex(full_idx, fill_value=0).astype(int)
    daily.index.name = "date"
    daily.name = "ticket_count"
    return daily


def quality_report(daily):
    """Quick sanity checks to print / paste in the README."""
    dow = daily.groupby(daily.index.dayofweek).mean().round(1)
    dow.index = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    return {
        "start": str(daily.index.min().date()),
        "end": str(daily.index.max().date()),
        "days": len(daily),
        "total_tickets": int(daily.sum()),
        "mean_per_day": round(daily.mean(), 2),
        "median_per_day": float(daily.median()),
        "max_per_day": int(daily.max()),
        "zero_days": int((daily == 0).sum()),
        "avg_by_weekday": dow.to_dict(),
    }


if __name__ == "__main__":
    import sys
    path = sys.argv[1] if len(sys.argv) > 1 else "data/raw/issues.csv"
    s = build_daily_series(load_issues(path))
    for k, v in quality_report(s).items():
        print(f"{k}: {v}")


# ---------------------------------------------------------------------------
# Holiday feature
# ---------------------------------------------------------------------------
def country_of(project_code):
    """Project codes look like 'C06gg__z0': the first 3 chars are the masked country (C00-C17).
    Internal projects have no country prefix -> 'OTHER'."""
    s = str(project_code)
    return s[:3] if len(s) >= 3 and s[0] == "C" and s[1:3].isdigit() else "OTHER"


def build_holiday_share(issues_path, holidays_path, index, weights_until=None,
                        start="2018-01-01", types=SUPPORT_TYPES):
    """Daily 'holiday_share' in [0, 1].

    = share of ticket volume coming from countries that have a public holiday that day.
    Weights are each country's share of tickets (before `weights_until`, so the
    test period never influences the feature). Holidays are known in advance,
    so this feature is legal to use for future dates.
    """
    df = pd.read_csv(issues_path, usecols=["issue_type", "issue_proj", "issue_created"])
    df["issue_created"] = pd.to_datetime(df["issue_created"], utc=True, format="ISO8601")
    df = df[df["issue_type"].isin(types) & (df["issue_created"] >= pd.Timestamp(start, tz="UTC"))]
    if weights_until is not None:
        df = df[df["issue_created"] < pd.Timestamp(weights_until, tz="UTC")]
    weights = df["issue_proj"].map(country_of).value_counts(normalize=True)

    hol = pd.read_csv(holidays_path, parse_dates=["date"])
    share = pd.Series(0.0, index=pd.DatetimeIndex(index))
    for country, w in weights.items():
        if country == "OTHER":
            continue
        days = pd.DatetimeIndex(hol.loc[hol["country"] == country, "date"])
        share[share.index.isin(days)] += w
    share.name = "holiday_share"
    return share, weights
