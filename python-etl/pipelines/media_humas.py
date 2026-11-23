import datetime as dt
import re
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.parse import parse_qsl, urlencode, urlparse, urlsplit

from .common import (
    ClickHouseClientWrapper,
    get_clickhouse_config,
    serialize_rows_for_json,
    sync_to_custom_table,
    validate_custom_target_params,
    write_csv_to_tmp,
)

TABLE_NAME = "dataset.publikasi_media"
INVISIBLE = re.compile(r"[\u200b-\u200f\u2060\ufeff]")

OUTPUT_COLUMNS = [
    "ID",
    "JENIS BERITA",
    "TANGGAL AWAL",
    "TANGGAL AKHIR",
    "NAMA MEDIA",
    "SATKER_CODE",
    "JUDUL BERITA",
    "TAUTAN BERITA",
    "RAW",
    "LINK MEDIA",
]

OUTPUT_SCHEMA = [
    {"name": "ID", "type": "UInt64"},
    {"name": "JENIS BERITA", "type": "String"},
    {"name": "TANGGAL AWAL", "type": "Nullable(Date)"},
    {"name": "TANGGAL AKHIR", "type": "Nullable(Date)"},
    {"name": "NAMA MEDIA", "type": "Nullable(String)"},
    {"name": "SATKER_CODE", "type": "Nullable(String)"},
    {"name": "JUDUL BERITA", "type": "String"},
    {"name": "TAUTAN BERITA", "type": "String"},
    {"name": "RAW", "type": "Nullable(String)"},
    {"name": "LINK MEDIA", "type": "Nullable(String)"},
]

DB_COLUMNS = [
    "id",
    "jenis_berita",
    "tanggal_awal",
    "tanggal_akhir",
    "nama_media",
    "satker_code",
    "judul_berita",
    "tautan_berita",
    "raw",
    "link_media",
]

SATKER_RULES = [
    ("POLITEKNIK STIA MKS", [r"politeknik\s+(?:stia\s+(?:lan\s+)?|sekolah\s+tinggi\s+ilmu\s+administrasi\s+lembaga\s+administrasi\s+negara\s+)(?:makassar|mks)\b", r"poltek\s+stia\s+(?:lan\s+)?(?:makassar|mks)\b", r"stia\s*lan\s+(?:makassar|mks)\b", r"stia\s*makassar"]),
    ("POLITEKNIK STIA JKT", [r"politeknik\s+(?:stia\s+(?:lan\s+)?|sekolah\s+tinggi\s+ilmu\s+administrasi\s+lembaga\s+administrasi\s+negara\s+)(?:jakarta|jkt)\b", r"poltek\s+stia\s+(?:lan\s+)?(?:jakarta|jkt)\b", r"stia\s*lan\s+(?:jakarta|jkt)\b", r"stia\s*jakarta"]),
    ("POLITEKNIK STIA BDG", [r"politeknik\s+(?:stia\s+(?:lan\s+)?|sekolah\s+tinggi\s+ilmu\s+administrasi\s+lembaga\s+administrasi\s+negara\s+)(?:bandung|bdg)\b", r"poltek\s+stia\s+(?:lan\s+)?(?:bandung|bdg)\b", r"stia\s*lan\s+(?:bandung|bdg)\b", r"stia\s*bandung"]),
    ("ACH", [r"pusjar\s*skmk", r"pusat\s+pembelajaran\s+standar\s+kompetensi\s+manajerial\s+dan\s+kepemimpinan", r"puslatbang\s*khan", r"pusat\s+pelatihan\s+dan\s+pengembangan\s+dan\s+kajian\s+hukum\s+administrasi\s+negara", r"\bkhan\b", r"\baceh\b"]),
    ("SMD", [r"pusjar\s*skpp", r"pusat\s+pembelajaran\s+standar\s+kompetensi\s+pelayanan\s+publik", r"puslatbang\s*kdod", r"pusat\s+pelatihan\s+dan\s+pengembangan\s+dan\s+kajian\s+desentralisasi\s+dan\s+otonomi\s+daerah", r"\bkdod\b", r"\bsamarinda\b"]),
    ("MKS", [r"pusjar\s*skmp", r"pusat\s+pembelajaran\s+standar\s+kompetensi\s+manajemen\s+pemerintahan", r"puslatbang\s*kmp", r"pusat\s+pelatihan\s+dan\s+pengembangan\s+dan\s+kajian\s+manajemen\s+pemerintahan", r"\bkmp\b", r"\bmakassar\b"]),
    ("BDG", [r"pusjar\s*sktan", r"pusjar\s*sk\s*tasnas", r"pusjar\s+strategi\s+kebijakan\s+talenta\s+asn\s+nasional", r"pusat\s+pembelajaran\s+standar\s+kompetensi\s+dan\s+talenta\s+asn\s+nasional", r"pusat\s+pembelajaran\s+dan\s+strategi\s+kebijakan\s+talenta\s+asn\s+nasional", r"puslatbang\s*pkasn", r"pusat\s+pelatihan\s+dan\s+pengembangan\s+dan\s+pemetaan\s+kompetensi\s+dan\s+penilaian\s+kinerja\s+asn", r"\bpkasn\b", r"\bjatinangor\b", r"\bbandung\b"]),
]

MONTHS_ID = {
    "januari": 1,
    "februari": 2,
    "pebruari": 2,
    "maret": 3,
    "april": 4,
    "mei": 5,
    "juni": 6,
    "juli": 7,
    "agustus": 8,
    "september": 9,
    "oktober": 10,
    "november": 11,
    "desember": 12,
}


def get_satker(text: str) -> Optional[str]:
    t = str(text).lower()
    for code, patterns in SATKER_RULES:
        if any(re.search(p, t) for p in patterns):
            return code
    return None


def get_section_header(text: str) -> Optional[str]:
    label = re.sub(r"[*_`]+", "", text).strip().rstrip(":").strip()
    patterns = [
        (r"media\s+sosial", "MEDIA SOSIAL"),
        (r"(?:youtube|instagram|twitter(?:\s*\(x\))?|tiktok|facebook)(?:\s*[-:].*)?", "MEDIA SOSIAL"),
        (r"media\s+(?:massa|online)", "MEDIA MASSA"),
        (r"(?:website(?:\s+lan)?|berita\s+terkini|awalan(?:\s*\([^)]*\))?)", "BERITA TERKINI"),
        (r"berita\s*unit", "BERITA UNIT"),
    ]
    for pattern, section in patterns:
        if re.fullmatch(pattern, label, re.I):
            return section
    return None


def parse_report_range(text: str):
    text = text.strip().strip("*_ ")
    compact = re.fullmatch(r"(?P<start>\d{1,2})\s*[-–]\s*(?P<end>\d{1,2})\s+(?P<month>[\w]+)\s+(?P<year>\d{4})", text, re.I)
    cross_month = re.fullmatch(
        r"(?P<start>\d{1,2})\s+(?P<start_month>[\w]+)\s*[-–]\s*(?P<end>\d{1,2})\s+(?P<end_month>[\w]+)\s+(?P<year>\d{4})",
        text,
        re.I,
    )
    full_dates = re.fullmatch(
        r"(?:[\w’']+\s+)?(?P<start>\d{1,2})\s+(?P<start_month>[\w]+)\s+(?P<start_year>\d{4})"
        r"\s*[-–]\s*(?:[\w’']+\s+)?(?P<end>\d{1,2})\s+(?P<end_month>[\w]+)\s+(?P<end_year>\d{4})",
        text,
        re.I,
    )
    try:
        if compact:
            month = MONTHS_ID.get(compact.group("month").lower())
            if month:
                year = int(compact.group("year"))
                return dt.date(year, month, int(compact.group("start"))), dt.date(year, month, int(compact.group("end")))
        if cross_month:
            start_month = MONTHS_ID.get(cross_month.group("start_month").lower())
            end_month = MONTHS_ID.get(cross_month.group("end_month").lower())
            if start_month and end_month:
                year = int(cross_month.group("year"))
                return dt.date(year, start_month, int(cross_month.group("start"))), dt.date(
                    year, end_month, int(cross_month.group("end"))
                )
        if full_dates:
            start_month = MONTHS_ID.get(full_dates.group("start_month").lower())
            end_month = MONTHS_ID.get(full_dates.group("end_month").lower())
            if start_month and end_month:
                return dt.date(int(full_dates.group("start_year")), start_month, int(full_dates.group("start"))), dt.date(
                    int(full_dates.group("end_year")), end_month, int(full_dates.group("end"))
                )
    except ValueError:
        return None
    return None


def get_media_name(url: str) -> Optional[str]:
    domain = (urlparse(url).hostname or "").lower().removeprefix("www.")
    if "youtube.com" in domain or "youtu.be" in domain:
        return "YOUTUBE"
    if "instagram.com" in domain:
        return "INSTAGRAM"
    if "tiktok.com" in domain:
        return "TIKTOK"
    if "twitter.com" in domain or "x.com" in domain:
        return "TWITTER (X)"
    if "facebook.com" in domain:
        return "FACEBOOK"
    if "lan.go.id" in domain:
        return "LAN RI"
    if domain == "sindonews.com" or domain.endswith(".sindonews.com"):
        return "SINDONEWS"
    if domain == "antaranews.com" or domain.endswith(".antaranews.com"):
        return "ANTARANEWS"
    if domain == "tribunnews.com" or domain.endswith(".tribunnews.com"):
        return "TRIBUNNEWS"
    return domain.split(".")[0].upper() if domain else None


def clean_url(url: str) -> str:
    url = str(url).strip()
    schemes = list(re.finditer(r"https?://", url, re.I))
    if len(schemes) > 1:
        url = url[schemes[-1].start():]
    return url


def url_key(url: str) -> str:
    parsed = urlsplit(clean_url(url))
    query = [
        (key, value)
        for key, value in parse_qsl(parsed.query)
        if not key.lower().startswith("utm_") and key.lower() not in {"fbclid", "igshid"}
    ]
    host = parsed.netloc.lower().removeprefix("www.")
    path = re.sub(r"^/amp(?=/)|/amp$", "", parsed.path.rstrip("/"), flags=re.I)
    return f"{host}{path}?{urlencode(query)}".rstrip("?")


def parse_chat_mingguan(raw_chat: str) -> List[Dict[str, Any]]:
    records: List[Dict[str, Any]] = []
    current_sec: Optional[str] = None
    buf_title = ""
    report_start: Optional[dt.date] = None
    report_end: Optional[dt.date] = None

    message_start = re.compile(r"^\d{1,2}/\d{1,2}/\d{2,4},?\s+\d{1,2}[.:]\d{2}\s+-\s+[^:]+:\s*(.*)$")
    item_date = re.compile(r"\d{1,2}\s*/\s*\d{1,2}(?:\s*/\s*\d{2,4})?")
    markdown_link = re.compile(r"\[([^\]]*)\]\((https?://[^)\s]+)\)")
    url_pattern = re.compile(r"https?://[^\s<>\]]+", re.I)
    social_tail = re.compile(r"\*(?=(?:youtube|instagram|twitter|tiktok|facebook)\b)", re.I)
    noise = re.compile(
        r"<media\s+(?:tidak\s+)?disertakan(?:\s+tidak)?>|program\s+germas|cek\s+kesehatan|berita\s+duka\s+cita|telah\s+(?:berpulang|meninggal\s+dunia)",
        re.I,
    )

    for raw_line in raw_chat.splitlines():
        raw_line = INVISIBLE.sub("", raw_line)
        line = raw_line.strip()
        if not line:
            continue
        message = message_start.match(line)
        if message:
            current_sec, buf_title = None, ""
            report_start = report_end = None
            line = message.group(1).strip()
            if not line:
                continue
        date_range = parse_report_range(line)
        if date_range:
            report_start, report_end = date_range
            buf_title = ""
            continue
        if item_date.fullmatch(line):
            buf_title = ""
            continue
        if noise.search(line):
            buf_title = ""
            continue
        header = get_section_header(line)
        if header:
            current_sec, buf_title = header, ""
            continue
        if current_sec is None:
            continue
        line = markdown_link.sub(
            lambda match: (match.group(1) + " " if not match.group(1).strip().lower().startswith("http") else "") + match.group(2),
            line,
        )
        url_match = url_pattern.search(line)
        if not url_match:
            buf_title = f"{buf_title} {line}".strip()
            continue
        url = clean_url(url_match.group(0))
        trailing = line[url_match.end():]
        glued_header = social_tail.search(url)
        if glued_header:
            trailing = url[glued_header.start():] + trailing
            url = url[:glued_header.start()]
        url = url.rstrip(".,;:!?)]}>")
        inline_title = line[:url_match.start()]
        title = re.sub(r"^\s*(?:\*?\d+[.)]\s*|[-•]\s*)", "", f"{buf_title} {inline_title}")
        title = re.sub(r"[*_`]+", "", title).strip(" \t:-")
        media_name = get_media_name(url)
        link_media = urlparse(url).netloc.lower().removeprefix("www.") or None

        records.append({
            "JENIS BERITA": current_sec,
            "TANGGAL AWAL": report_start,
            "TANGGAL AKHIR": report_end,
            "NAMA MEDIA": media_name,
            "SATKER_CODE": get_satker(title) if current_sec == "BERITA UNIT" else None,
            "JUDUL BERITA": title if title else "Publikasi Media LAN",
            "TAUTAN BERITA": url,
            "RAW": f"{buf_title} {raw_line.strip()}".strip(),
            "LINK MEDIA": link_media,
        })
        buf_title = ""
        trailing_header = get_section_header(trailing)
        if trailing_header:
            current_sec = trailing_header

    return records


def _ensure_table(client: ClickHouseClientWrapper) -> None:
    client.command("CREATE DATABASE IF NOT EXISTS dataset")
    client.command(
        f"""
        CREATE TABLE IF NOT EXISTS {TABLE_NAME} (
            id UInt64,
            jenis_berita String,
            tanggal_awal Nullable(Date),
            tanggal_akhir Nullable(Date),
            nama_media Nullable(String),
            satker_code Nullable(String),
            judul_berita String,
            tautan_berita String,
            raw Nullable(String),
            link_media Nullable(String)
        ) ENGINE = MergeTree
        ORDER BY id
        """
    )


def _dedupe_records(records: List[Dict[str, Any]], existing_keys: set) -> List[Dict[str, Any]]:
    seen = set()
    unique: List[Dict[str, Any]] = []
    for rec in records:
        key = url_key(rec["TAUTAN BERITA"])
        if key in seen or key in existing_keys:
            continue
        seen.add(key)
        unique.append(rec)
    return unique


def run(
    action: str = "preview",
    input_path: Optional[str] = None,
    raw_text: Optional[str] = None,
    target_db: Optional[str] = None,
    target_table: Optional[str] = None,
    engine: Optional[str] = None,
    order_by: Optional[str] = None,
    **_: Any,
) -> Dict[str, Any]:
    text = raw_text or ""
    if not text.strip() and input_path:
        text = Path(input_path).read_text(encoding="utf-8", errors="replace")

    if not text.strip():
        raise ValueError("Teks broadcast WA atau file .txt wajib diisi untuk pipeline Publikasi Media Humas.")

    custom_target = validate_custom_target_params(target_db, target_table, engine, order_by, OUTPUT_SCHEMA)
    effective_target = f"{custom_target[0]}.{custom_target[1]}" if custom_target else TABLE_NAME

    parsed = parse_chat_mingguan(text)
    if not parsed:
        return {
            "status": "ok",
            "pipeline": "media_humas",
            "action": action,
            "targetTable": effective_target,
            "columns": OUTPUT_COLUMNS,
            "column_schema": OUTPUT_SCHEMA,
            "rows": [],
            "total_rows": 0,
            "csv_path": None,
            "csv_filename": None,
            "summary": {
                "parsed_count": 0,
                "inserted_count": 0,
                "skipped_duplicate_count": 0,
                "by_jenis_berita": {},
                "periode": None,
            },
            "message": "Tidak ada berita terbaca. Cek penulisan periode tanggal dan header seksi (Media Online, Berita Unit, dst).",
        }

    by_jenis: Dict[str, int] = {}
    for rec in parsed:
        jb = str(rec["JENIS BERITA"])
        by_jenis[jb] = by_jenis.get(jb, 0) + 1

    periode_start = parsed[0]["TANGGAL AWAL"]
    periode_end = parsed[0]["TANGGAL AKHIR"]
    periode_str = (
        f"{periode_start.isoformat()} s.d. {periode_end.isoformat()}"
        if periode_start and periode_end
        else None
    )

    ch_conf = get_clickhouse_config()
    inserted_count = 0
    skipped_duplicate_count = 0

    if action == "sync_db" and custom_target is not None:
        client = ClickHouseClientWrapper(ch_conf)
        output_rows: List[Dict[str, Any]] = []
        payload: List[List[Any]] = []
        for idx, rec in enumerate(parsed):
            rec_id = idx + 1
            output_rows.append({"ID": rec_id, **rec})
            payload.append([
                int(rec_id),
                str(rec["JENIS BERITA"]),
                rec["TANGGAL AWAL"],
                rec["TANGGAL AKHIR"],
                None if rec["NAMA MEDIA"] is None else str(rec["NAMA MEDIA"]),
                None if rec["SATKER_CODE"] is None else str(rec["SATKER_CODE"]),
                str(rec["JUDUL BERITA"] or ""),
                str(rec["TAUTAN BERITA"]),
                None if rec["RAW"] is None else str(rec["RAW"]),
                None if rec["LINK MEDIA"] is None else str(rec["LINK MEDIA"]),
            ])
        effective_target = sync_to_custom_table(
            client=client,
            target_db=custom_target[0],
            target_table=custom_target[1],
            engine=custom_target[2],
            order_by=custom_target[3],
            column_schema=OUTPUT_SCHEMA,
            rows_payload=payload,
        )
        inserted_count = len(payload)
        msg = f"Berhasil membuat tabel baru {effective_target} ({custom_target[2]}) dan memasukkan {inserted_count} baris hasil ETL."
    elif action == "sync_db":
        client = ClickHouseClientWrapper(ch_conf)
        _ensure_table(client)
        existing_rows = client.query_rows(f"SELECT id, tautan_berita FROM {TABLE_NAME}")
        existing_keys = {url_key(r[1]) for r in existing_rows if len(r) > 1 and r[1]}
        next_id = max((int(r[0]) for r in existing_rows if r and r[0] is not None), default=0) + 1

        new_records = _dedupe_records(parsed, existing_keys)
        skipped_duplicate_count = len(parsed) - len(new_records)
        payload = []
        output_rows = []

        for idx, rec in enumerate(new_records):
            rec_id = next_id + idx
            row_with_id = {"ID": rec_id, **rec}
            output_rows.append(row_with_id)
            payload.append([
                int(rec_id),
                str(rec["JENIS BERITA"]),
                rec["TANGGAL AWAL"],
                rec["TANGGAL AKHIR"],
                None if rec["NAMA MEDIA"] is None else str(rec["NAMA MEDIA"]),
                None if rec["SATKER_CODE"] is None else str(rec["SATKER_CODE"]),
                str(rec["JUDUL BERITA"] or ""),
                str(rec["TAUTAN BERITA"]),
                None if rec["RAW"] is None else str(rec["RAW"]),
                None if rec["LINK MEDIA"] is None else str(rec["LINK MEDIA"]),
            ])

        if payload:
            client.insert(TABLE_NAME, payload, column_names=DB_COLUMNS)
            inserted_count = len(payload)
        msg = (
            f"Berhasil menambahkan {inserted_count} berita baru ke {TABLE_NAME}."
            if inserted_count > 0
            else f"Tidak ada URL baru; seluruh tautan ({len(parsed)} baris) sudah ada di {TABLE_NAME}."
        )
    else:
        output_rows = [{"ID": idx + 1, **rec} for idx, rec in enumerate(parsed)]
        unique_in_batch = _dedupe_records(parsed, set())
        skipped_duplicate_count = len(parsed) - len(unique_in_batch)
        msg = f"Berhasil memproses {len(output_rows)} berita dari teks broadcast WA."

    serialized = serialize_rows_for_json(OUTPUT_COLUMNS, output_rows)
    stamp = dt.datetime.now().strftime("%Y%m%d%H%M")
    csv_path, csv_filename = write_csv_to_tmp(f"publikasi_media_humas_{stamp}.csv", OUTPUT_COLUMNS, serialized)

    return {
        "status": "ok",
        "pipeline": "media_humas",
        "action": action,
        "targetTable": effective_target,
        "columns": OUTPUT_COLUMNS,
        "column_schema": OUTPUT_SCHEMA,
        "rows": serialized,
        "total_rows": len(serialized),
        "csv_path": csv_path,
        "csv_filename": csv_filename,
        "summary": {
            "parsed_count": len(parsed),
            "inserted_count": inserted_count,
            "skipped_duplicate_count": skipped_duplicate_count,
            "by_jenis_berita": by_jenis,
            "periode": periode_str,
        },
        "message": msg,
    }
