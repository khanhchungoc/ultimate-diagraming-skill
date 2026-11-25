"""Public holiday fetcher and timezone-to-country mapper for Gantt roadmaps.

Stdlib only (zero third-party dependencies). Fetches public holidays from Nager.Date
during generation, caches them on disk with a 30-day TTL, and falls back gracefully
when offline or when the local timezone cannot be mapped to a country.
"""

from __future__ import annotations

import datetime
import json
import os
import re
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

CACHE_TTL_SECONDS = 30 * 24 * 60 * 60
DEFAULT_TIMEOUT = 3.0
MAX_YEAR_SPAN = 5
NAGER_URL_TEMPLATE = "https://date.nager.at/api/v3/PublicHolidays/{year}/{country}"

_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_CC_RE = re.compile(r"^[A-Z]{2}$")

# Clean IANA timezone -> ISO-3166-1 alpha-2 country code table covering major world timezones.
IANA_TO_COUNTRY: Dict[str, str] = {
    # United States
    "America/New_York": "US",
    "America/Detroit": "US",
    "America/Kentucky/Louisville": "US",
    "America/Kentucky/Monticello": "US",
    "America/Indiana/Indianapolis": "US",
    "America/Indiana/Vincennes": "US",
    "America/Indiana/Winamac": "US",
    "America/Indiana/Marengo": "US",
    "America/Indiana/Petersburg": "US",
    "America/Indiana/Vevay": "US",
    "America/Chicago": "US",
    "America/Indiana/Tell_City": "US",
    "America/Indiana/Knox": "US",
    "America/Menominee": "US",
    "America/North_Dakota/Center": "US",
    "America/North_Dakota/New_Salem": "US",
    "America/North_Dakota/Beulah": "US",
    "America/Denver": "US",
    "America/Boise": "US",
    "America/Phoenix": "US",
    "America/Los_Angeles": "US",
    "America/Anchorage": "US",
    "America/Juneau": "US",
    "America/Sitka": "US",
    "America/Metlakatla": "US",
    "America/Yakutat": "US",
    "America/Nome": "US",
    "America/Adak": "US",
    "Pacific/Honolulu": "US",
    "US/Eastern": "US",
    "US/Central": "US",
    "US/Mountain": "US",
    "US/Pacific": "US",
    "US/Alaska": "US",
    "US/Hawaii": "US",
    "US/Arizona": "US",
    # Canada
    "America/St_Johns": "CA",
    "America/Halifax": "CA",
    "America/Glace_Bay": "CA",
    "America/Moncton": "CA",
    "America/Goose_Bay": "CA",
    "America/Toronto": "CA",
    "America/Montreal": "CA",
    "America/Nipigon": "CA",
    "America/Thunder_Bay": "CA",
    "America/Iqaluit": "CA",
    "America/Winnipeg": "CA",
    "America/Regina": "CA",
    "America/Swift_Current": "CA",
    "America/Edmonton": "CA",
    "America/Yellowknife": "CA",
    "America/Vancouver": "CA",
    "America/Whitehorse": "CA",
    "America/Dawson": "CA",
    "Canada/Eastern": "CA",
    "Canada/Central": "CA",
    "Canada/Mountain": "CA",
    "Canada/Pacific": "CA",
    "Canada/Atlantic": "CA",
    "Canada/Newfoundland": "CA",
    # United Kingdom & Ireland
    "Europe/London": "GB",
    "Europe/Belfast": "GB",
    "GB": "GB",
    "Europe/Dublin": "IE",
    "Eire": "IE",
    # Western, Northern, Central & Southern Europe
    "Europe/Berlin": "DE",
    "Europe/Busingen": "DE",
    "Europe/Paris": "FR",
    "Europe/Amsterdam": "NL",
    "Europe/Brussels": "BE",
    "Europe/Luxembourg": "LU",
    "Europe/Zurich": "CH",
    "Europe/Vienna": "AT",
    "Europe/Stockholm": "SE",
    "Europe/Oslo": "NO",
    "Europe/Copenhagen": "DK",
    "Europe/Helsinki": "FI",
    "Atlantic/Reykjavik": "IS",
    "Europe/Madrid": "ES",
    "Atlantic/Canary": "ES",
    "Europe/Lisbon": "PT",
    "Atlantic/Madeira": "PT",
    "Atlantic/Azores": "PT",
    "Europe/Rome": "IT",
    "Europe/Warsaw": "PL",
    "Europe/Prague": "CZ",
    "Europe/Bratislava": "SK",
    "Europe/Budapest": "HU",
    "Europe/Bucharest": "RO",
    "Europe/Sofia": "BG",
    "Europe/Athens": "GR",
    "Europe/Zagreb": "HR",
    "Europe/Ljubljana": "SI",
    "Europe/Belgrade": "RS",
    "Europe/Tallinn": "EE",
    "Europe/Riga": "LV",
    "Europe/Vilnius": "LT",
    "Europe/Kyiv": "UA",
    "Europe/Kiev": "UA",
    "Europe/Istanbul": "TR",
    "Asia/Istanbul": "TR",
    "Europe/Moscow": "RU",
    "Asia/Yekaterinburg": "RU",
    "Asia/Novosibirsk": "RU",
    "Asia/Vladivostok": "RU",
    # Southeast Asia
    "Asia/Ho_Chi_Minh": "VN",
    "Asia/Saigon": "VN",
    "Asia/Hanoi": "VN",
    "Asia/Singapore": "SG",
    "Singapore": "SG",
    "Asia/Bangkok": "TH",
    "Asia/Jakarta": "ID",
    "Asia/Pontianak": "ID",
    "Asia/Makassar": "ID",
    "Asia/Jayapura": "ID",
    "Asia/Kuala_Lumpur": "MY",
    "Asia/Kuching": "MY",
    "Asia/Manila": "PH",
    "Asia/Phnom_Penh": "KH",
    "Asia/Vientiane": "LA",
    "Asia/Yangon": "MM",
    "Asia/Rangoon": "MM",
    "Asia/Brunei": "BN",
    # East Asia
    "Asia/Tokyo": "JP",
    "Japan": "JP",
    "Asia/Seoul": "KR",
    "ROK": "KR",
    "Asia/Shanghai": "CN",
    "Asia/Chongqing": "CN",
    "Asia/Harbin": "CN",
    "Asia/Urumqi": "CN",
    "PRC": "CN",
    "Asia/Taipei": "TW",
    "ROC": "TW",
    "Asia/Hong_Kong": "HK",
    "Hongkong": "HK",
    "Asia/Macau": "MO",
    # South & West Asia
    "Asia/Kolkata": "IN",
    "Asia/Calcutta": "IN",
    "Asia/Colombo": "LK",
    "Asia/Dhaka": "BD",
    "Asia/Karachi": "PK",
    "Asia/Kathmandu": "NP",
    "Asia/Dubai": "AE",
    "Asia/Riyadh": "SA",
    "Asia/Qatar": "QA",
    "Asia/Kuwait": "KW",
    "Asia/Jerusalem": "IL",
    "Asia/Tel_Aviv": "IL",
    # Oceania
    "Australia/Sydney": "AU",
    "Australia/Melbourne": "AU",
    "Australia/Brisbane": "AU",
    "Australia/Perth": "AU",
    "Australia/Adelaide": "AU",
    "Australia/Hobart": "AU",
    "Australia/Darwin": "AU",
    "Australia/Canberra": "AU",
    "Australia/ACT": "AU",
    "Australia/NSW": "AU",
    "Australia/Victoria": "AU",
    "Australia/Queensland": "AU",
    "Australia/West": "AU",
    "Australia/South": "AU",
    "Pacific/Auckland": "NZ",
    "Pacific/Chatham": "NZ",
    "NZ": "NZ",
    # Latin America
    "America/Sao_Paulo": "BR",
    "America/Manaus": "BR",
    "America/Fortaleza": "BR",
    "America/Recife": "BR",
    "America/Bahia": "BR",
    "America/Belem": "BR",
    "America/Cuiaba": "BR",
    "Brazil/East": "BR",
    "America/Mexico_City": "MX",
    "America/Cancun": "MX",
    "America/Monterrey": "MX",
    "America/Tijuana": "MX",
    "America/Chihuahua": "MX",
    "Mexico/General": "MX",
    "America/Argentina/Buenos_Aires": "AR",
    "America/Buenos_Aires": "AR",
    "America/Santiago": "CL",
    "America/Bogota": "CO",
    "America/Lima": "PE",
    "America/Montevideo": "UY",
    "America/Costa_Rica": "CR",
    "America/Panama": "PA",
    # Africa
    "Africa/Johannesburg": "ZA",
    "Africa/Cairo": "EG",
    "Africa/Lagos": "NG",
    "Africa/Nairobi": "KE",
    "Africa/Casablanca": "MA",
}

# Unambiguous Windows display-name fallback for detect_local_country()
_WINDOWS_TZ_TO_COUNTRY: Dict[str, str] = {
    "SE Asia Standard Time": "VN",
    "Singapore Standard Time": "SG",
    "Tokyo Standard Time": "JP",
    "Korea Standard Time": "KR",
    "China Standard Time": "CN",
    "Taipei Standard Time": "TW",
    "India Standard Time": "IN",
    "AUS Eastern Standard Time": "AU",
    "W. Australia Standard Time": "AU",
    "New Zealand Standard Time": "NZ",
    "GMT Standard Time": "GB",
    "W. Europe Standard Time": "DE",
    "Romance Standard Time": "FR",
    "Central European Standard Time": "PL",
    "Eastern Standard Time": "US",
    "Central Standard Time": "US",
    "Mountain Standard Time": "US",
    "Pacific Standard Time": "US",
    "Alaskan Standard Time": "US",
    "Hawaiian Standard Time": "US",
    "E. South America Standard Time": "BR",
    "Central Standard Time (Mexico)": "MX",
}


def iana_to_country(tz_name: Optional[str]) -> Optional[str]:
    """Map an IANA (or Windows fallback) timezone name to an ISO-3166-1 alpha-2 country code."""
    if not tz_name or not isinstance(tz_name, str):
        return None
    name = tz_name.strip().lstrip(":")
    if not name:
        return None
    if name in IANA_TO_COUNTRY:
        return IANA_TO_COUNTRY[name]
    if name in _WINDOWS_TZ_TO_COUNTRY:
        return _WINDOWS_TZ_TO_COUNTRY[name]
    return None


def _read_local_timezone() -> Optional[str]:
    """Best-effort detection of the local IANA timezone name."""
    env_tz = os.environ.get("TZ", "").strip().lstrip(":")
    if env_tz:
        return env_tz

    etc_tz = Path("/etc/timezone")
    try:
        if etc_tz.is_file():
            content = etc_tz.read_text(encoding="utf-8").strip()
            if content:
                return content
    except OSError:
        pass

    localtime = Path("/etc/localtime")
    try:
        if localtime.is_symlink():
            target = os.readlink(localtime)
            if "zoneinfo/" in target:
                return target.split("zoneinfo/", 1)[1].lstrip("/")
    except OSError:
        pass

    try:
        tzinfo = datetime.datetime.now().astimezone().tzinfo
        key = getattr(tzinfo, "key", None)
        if isinstance(key, str) and key:
            return key
        tz_str = str(tzinfo) if tzinfo is not None else ""
        if tz_str in IANA_TO_COUNTRY or tz_str in _WINDOWS_TZ_TO_COUNTRY:
            return tz_str
    except Exception:
        pass

    for name in getattr(time, "tzname", ()):
        if name in IANA_TO_COUNTRY or name in _WINDOWS_TZ_TO_COUNTRY:
            return name

    return None


def detect_local_country() -> Optional[str]:
    """Detect the local IANA timezone and map it to an ISO-3166-1 alpha-2 country code."""
    return iana_to_country(_read_local_timezone())


def _default_cache_dir() -> Path:
    return Path.home() / ".cache" / "ultimate-diagram" / "holidays"


def _is_valid_date(val: Any) -> bool:
    if not isinstance(val, str) or not _DATE_RE.match(val):
        return False
    try:
        datetime.date.fromisoformat(val)
        return True
    except ValueError:
        return False


def _normalize_entries(raw: Any, country: str) -> List[Dict[str, str]]:
    if not isinstance(raw, list):
        raise ValueError("Expected JSON list of holidays")
    out: List[Dict[str, str]] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        date_str = item.get("date")
        if not _is_valid_date(date_str):
            continue
        end_str = item.get("end")
        if not _is_valid_date(end_str):
            end_str = date_str
        name = item.get("name") or item.get("localName") or ""
        if not isinstance(name, str):
            name = str(name)
        name = name.strip()
        if not name:
            continue
        out.append({
            "date": date_str,
            "end": end_str,
            "name": name,
            "country": country,
        })
    return out


def _read_cache(cache_file: Path, ttl: int = CACHE_TTL_SECONDS) -> Optional[List[Dict[str, str]]]:
    try:
        if not cache_file.is_file():
            return None
        age = time.time() - cache_file.stat().st_mtime
        if age < 0 or age >= ttl:
            return None
        payload = json.loads(cache_file.read_text(encoding="utf-8"))
        if not isinstance(payload, list):
            return None
        return payload
    except (OSError, ValueError):
        return None


def _write_cache_atomic(cache_file: Path, entries: List[Dict[str, str]]) -> None:
    try:
        cache_file.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp_name = tempfile.mkstemp(prefix=".holidays-", suffix=".tmp", dir=str(cache_file.parent))
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as fh:
                json.dump(entries, fh, ensure_ascii=False, indent=2)
            os.replace(tmp_name, cache_file)
        except Exception:
            try:
                os.unlink(tmp_name)
            except OSError:
                pass
            raise
    except OSError:
        # Read-only or unavailable cache directory should never fail holiday resolution.
        pass


def _urllib_fetch(url: str, timeout: float) -> bytes:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "ultimate-diagram-skill/1.0",
            "Accept": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        status = getattr(resp, "status", 200)
        if status == 204:
            return b"[]"
        if status != 200:
            raise urllib.error.HTTPError(url, status, f"HTTP {status}", resp.headers, None)
        return resp.read()


def fetch_country_holidays(
    country: str,
    year: int,
    cache_dir: Optional[Path] = None,
    fetcher: Optional[Callable[[str, float], Any]] = None,
    timeout: float = DEFAULT_TIMEOUT,
) -> Tuple[List[Dict[str, str]], Optional[str]]:
    """Fetch public holidays for (country, year), using a 30-day on-disk cache.

    Returns (entries, error_message). On any network, timeout, HTTP, or JSON error,
    returns ([], "offline or unavailable") without raising.
    """
    cc = country.strip().upper() if isinstance(country, str) else ""
    if not _CC_RE.match(cc):
        return [], f"invalid country code '{country}'"

    cdir = Path(cache_dir) if cache_dir is not None else _default_cache_dir()
    cache_file = cdir / f"{cc}-{int(year)}.json"

    cached = _read_cache(cache_file)
    if cached is not None:
        return cached, None

    url = NAGER_URL_TEMPLATE.format(year=int(year), country=cc)
    fetch_fn = fetcher if fetcher is not None else _urllib_fetch
    try:
        raw_resp = fetch_fn(url, timeout)
        if isinstance(raw_resp, bytes):
            parsed = json.loads(raw_resp.decode("utf-8"))
        elif isinstance(raw_resp, str):
            parsed = json.loads(raw_resp)
        else:
            parsed = raw_resp
        entries = _normalize_entries(parsed, cc)
    except Exception:
        return [], "offline or unavailable"

    _write_cache_atomic(cache_file, entries)
    return entries, None


def _extract_year_span(data: Dict[str, Any]) -> List[int]:
    years: List[int] = []
    for item in data.get("items") or []:
        if not isinstance(item, dict):
            continue
        for key in ("start", "end"):
            val = item.get(key)
            if _is_valid_date(val):
                years.append(int(val[:4]))
    for marker in data.get("markers") or []:
        if not isinstance(marker, dict):
            continue
        val = marker.get("date")
        if _is_valid_date(val):
            years.append(int(val[:4]))
    if not years:
        return []
    lo, hi = min(years), max(years)
    if hi - lo + 1 > MAX_YEAR_SPAN:
        hi = lo + MAX_YEAR_SPAN - 1
    return list(range(lo, hi + 1))


def _dedupe_and_sort(entries: List[Dict[str, str]]) -> List[Dict[str, str]]:
    seen = set()
    merged: List[Dict[str, str]] = []
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        date_str = entry.get("date")
        if not _is_valid_date(date_str):
            continue
        end_str = entry.get("end") if _is_valid_date(entry.get("end")) else date_str
        name = str(entry.get("name") or "").strip()
        key = (date_str, end_str, name.lower())
        if key in seen:
            continue
        seen.add(key)
        clean: Dict[str, str] = {"date": date_str, "end": end_str, "name": name}
        if entry.get("country"):
            clean["country"] = str(entry["country"]).strip().upper()
        merged.append(clean)
    merged.sort(key=lambda e: (e["date"], e["end"], e.get("name", ""), e.get("country", "")))
    return merged


def resolve_holidays(
    data: Dict[str, Any],
    *,
    no_holidays: bool = False,
    cache_dir: Optional[Path] = None,
    fetcher: Optional[Callable[[str, float], Any]] = None,
    country_detector: Optional[Callable[[], Optional[str]]] = None,
) -> List[str]:
    """Resolve and merge public holidays into data['holidays'] based on data.get('_holidayMode').

    Returns a list of '[INFO] ...' status lines.
    """
    if no_holidays:
        return []

    raw_mode = data.get("_holidayMode")
    mode = "auto" if raw_mode is None or str(raw_mode).strip() == "" else str(raw_mode).strip()
    if mode.lower() == "none":
        return []

    infos: List[str] = []
    countries: List[str] = []
    if mode.lower() == "auto":
        detector = country_detector if country_detector is not None else detect_local_country
        detected = detector()
        if not detected:
            return ["[INFO] Holidays skipped (local timezone could not be mapped to a country)"]
        countries = [detected.strip().upper()]
    else:
        seen_cc = set()
        for part in mode.split(","):
            cc = part.strip().upper()
            if not cc:
                continue
            if not _CC_RE.match(cc):
                infos.append(f"[INFO] Ignored invalid holiday country code '{part.strip()}'")
                continue
            if cc not in seen_cc:
                seen_cc.add(cc)
                countries.append(cc)
        if not countries:
            return infos

    years = _extract_year_span(data)
    if not years:
        return infos

    fetched_all: List[Dict[str, str]] = []
    any_success = False
    for cc in countries:
        cc_entries: List[Dict[str, str]] = []
        cc_errors: List[str] = []
        ok_years: List[int] = []
        for yr in years:
            entries, err = fetch_country_holidays(cc, yr, cache_dir=cache_dir, fetcher=fetcher)
            if err is not None:
                cc_errors.append(err)
            else:
                ok_years.append(yr)
                cc_entries.extend(entries)
        if ok_years:
            any_success = True
            fetched_all.extend(cc_entries)
            yr_label = str(ok_years[0]) if len(ok_years) == 1 else f"{ok_years[0]}-{ok_years[-1]}"
            infos.append(f"[INFO] Loaded {len(cc_entries)} holidays for {cc} ({yr_label})")
        elif cc_errors:
            infos.append(f"[INFO] Holidays skipped for {cc} ({cc_errors[0]})")

    existing = data.get("holidays") or []
    if fetched_all or existing:
        data["holidays"] = _dedupe_and_sort(list(existing) + fetched_all)
    elif not any_success and "holidays" not in data:
        data["holidays"] = []

    return infos
