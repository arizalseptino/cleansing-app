import datetime as dt
import os
import re
from typing import Any, Dict, List, Optional

from .common import (
    ClickHouseClientWrapper,
    get_clickhouse_config,
    is_missing,
    read_excel_sheets,
    serialize_rows_for_json,
    write_csv_to_tmp,
)

TABLE_NAME = "dataset.anggaran"
OUTPUT_COLUMNS = [
    "satker_lan",
    "tahun",
    "disagregasi",
    "klasifikasi",
    "alias",
    "pagu_anggaran",
    "sp2d_span",
    "sisa_dana",
    "persen_realisasi",
    "id",
]


def clean_number(value: Any) -> Optional[str]:
    if is_missing(value):
        return None
    if isinstance(value, (int, float)):
        if isinstance(value, float) and value.is_integer():
            return str(int(value))
        return str(int(value)) if float(value) == int(float(value)) else str(value)
    s = str(value).strip()
    if not s or s.lower() in {"nan", "none", ""}:
        return None
    s = s.replace(".", "").replace(",", "")
    try:
        num = float(s)
        return str(int(num)) if num == int(num) else str(num)
    except Exception:
        return None


def format_percentage(value: Any) -> Optional[float]:
    if is_missing(value):
        return None
    try:
        val = float(str(value).strip().replace("%", "").replace(",", "."))
        return round(val, 6)
    except Exception:
        return None


def clean_satker_name(value: Any) -> Optional[str]:
    if is_missing(value):
        return None
    s = str(value).strip()
    if not s or s.lower() in {"nan", "none", ""}:
        return None
    s = re.sub(r"[|*]\s*$", "", s).strip()
    return s if s else None


def _cell(row: List[Any], idx: int) -> Any:
    return row[idx] if idx < len(row) else None


def _parse_pipe_sheet(rows: List[List[Any]], disagregasi: str, tahun_date: str) -> List[Dict[str, Any]]:
    records: List[Dict[str, Any]] = []
    for idx, row in enumerate(rows):
        v0 = _cell(row, 0)
        v1 = _cell(row, 1)
        col0 = str(v0).strip() if not is_missing(v0) else ""
        col1 = str(v1).strip() if not is_missing(v1) else ""
        col2 = _cell(row, 2)
        col4 = _cell(row, 3)
        col5 = _cell(row, 4)
        col6 = _cell(row, 5)

        if "|" in col1:
            klasifikasi = col1
            pagu = clean_number(col2)
            realisasi = clean_number(col4)
            sisa = clean_number(col5)
            persen = format_percentage(col6)

            satker_lan: Optional[str] = None
            if col0.isdigit():
                if idx > 0:
                    prev_row = rows[idx - 1]
                    pv1 = _cell(prev_row, 1)
                    prev_col1 = str(pv1).strip() if not is_missing(pv1) else ""
                    if prev_col1 and "|" not in prev_col1:
                        satker_lan = prev_col1
            else:
                for prev_idx in range(idx - 1, -1, -1):
                    prev_row = rows[prev_idx]
                    pv0 = _cell(prev_row, 0)
                    pv1 = _cell(prev_row, 1)
                    prev_col0 = str(pv0).strip() if not is_missing(pv0) else ""
                    prev_col1 = str(pv1).strip() if not is_missing(pv1) else ""
                    if prev_col0.isdigit() and prev_col1 and "|" not in prev_col1:
                        satker_lan = prev_col1
                        break

            if satker_lan and pagu:
                records.append({
                    "satker_lan": satker_lan,
                    "tahun": tahun_date,
                    "disagregasi": disagregasi,
                    "klasifikasi": klasifikasi,
                    "alias": "",
                    "pagu_anggaran": pagu,
                    "sp2d_span": realisasi or "",
                    "sisa_dana": sisa or "",
                    "persen_realisasi": persen or 0.0,
                })
    return records


def parse_per_sumber_dana_v2(rows: List[List[Any]], tahun_date: str) -> List[Dict[str, Any]]:
    return _parse_pipe_sheet(rows, "SUMBER DANA", tahun_date)


def parse_per_jenis_belanja_v2(rows: List[List[Any]], tahun_date: str) -> List[Dict[str, Any]]:
    return _parse_pipe_sheet(rows, "JENIS BELANJA", tahun_date)


def parse_realisasi_sp2d_lan_jkt_eselon_ii(rows: List[List[Any]], tahun_date: str) -> List[Dict[str, Any]]:
    records: List[Dict[str, Any]] = []
    for row in rows:
        v0 = _cell(row, 0)
        v1 = _cell(row, 1)
        col0 = str(v0).strip() if not is_missing(v0) else ""
        col1 = str(v1).strip() if not is_missing(v1) else ""
        col2 = _cell(row, 2)
        col3 = _cell(row, 3)
        col4 = _cell(row, 4)
        col5 = _cell(row, 5)
        v19 = _cell(row, 19)
        col19 = str(v19).strip() if not is_missing(v19) else ""

        is_main_org = (
            len(col0) == 1
            and col0.isalpha()
            and (
                col1.startswith("Biro ")
                or col1.startswith("Deputi ")
                or col1.startswith("Direktorat ")
                or col1.startswith("Inspektorat")
                or col1.startswith("Pusat Data")
            )
        )
        has_pagu = not is_missing(col2) and isinstance(col2, (int, float)) and col2 > 0
        if is_main_org and has_pagu:
            klasifikasi = col1.replace("\n", " ").strip()
            alias = col19 or ""
            pagu = clean_number(col2)
            sp2d = clean_number(col3)
            sisa = clean_number(col4)
            persen = format_percentage(col5 if not is_missing(col5) else 0)
            if pagu:
                records.append({
                    "satker_lan": "LAN JAKARTA",
                    "tahun": tahun_date,
                    "disagregasi": "ESELON II",
                    "klasifikasi": klasifikasi,
                    "alias": alias,
                    "pagu_anggaran": pagu,
                    "sp2d_span": sp2d or "",
                    "sisa_dana": sisa or "",
                    "persen_realisasi": persen or 0.0,
                })
    return records


def _ensure_table(client: ClickHouseClientWrapper) -> None:
    client.command("CREATE DATABASE IF NOT EXISTS dataset")
    client.command(
        f"""
        CREATE TABLE IF NOT EXISTS {TABLE_NAME} (
            satker_lan String,
            tahun String,
            disagregasi String,
            klasifikasi String,
            alias String,
            pagu_anggaran String,
            sp2d_span String,
            sisa_dana String,
            persen_realisasi Float64,
            id UInt64
        ) ENGINE = MergeTree
        ORDER BY id
        """
    )


def _to_int_sum(rows: List[Dict[str, Any]], key: str) -> int:
    total = 0
    for r in rows:
        val = r.get(key)
        if val:
            try:
                total += int(float(str(val)))
            except Exception:
                pass
    return total


def run(
    action: str = "preview",
    input_path: Optional[str] = None,
    tanggal_realisasi: Optional[str] = None,
    **_: Any,
) -> Dict[str, Any]:
    if not input_path or not os.path.exists(input_path):
        raise ValueError("File Excel (.xlsx) Realisasi Anggaran SP2D wajib diunggah.")

    tahun_date = (tanggal_realisasi or "").strip() or dt.date.today().isoformat()
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", tahun_date):
        raise ValueError("Format tanggal realisasi harus YYYY-MM-DD.")

    required_sheets = [
        "realisasi per sumber dana- SP2D",
        "realisasi per jenis blnj SP2D",
        "realisasi bend lan jkt",
    ]
    sheets = read_excel_sheets(input_path, sheet_names=required_sheets, header=None)

    df_sumber_dana = parse_per_sumber_dana_v2(sheets["realisasi per sumber dana- SP2D"], tahun_date)
    df_jenis_belanja = parse_per_jenis_belanja_v2(sheets["realisasi per jenis blnj SP2D"], tahun_date)
    df_eselon_ii = parse_realisasi_sp2d_lan_jkt_eselon_ii(sheets["realisasi bend lan jkt"], tahun_date)

    combined = df_sumber_dana + df_jenis_belanja + df_eselon_ii

    ch_conf = get_clickhouse_config()
    current_max_id = 0
    total_before = 0
    total_after = 0

    if action == "sync_db":
        client = ClickHouseClientWrapper(ch_conf)
        _ensure_table(client)
        count_rows = client.query_rows(f"SELECT count(*) FROM {TABLE_NAME}")
        total_before = int(count_rows[0][0]) if count_rows and count_rows[0] else 0
        max_rows = client.query_rows(f"SELECT max(id) FROM {TABLE_NAME}")
        raw_max = max_rows[0][0] if max_rows and max_rows[0] else 0
        current_max_id = int(raw_max or 0)

        for idx, rec in enumerate(combined):
            rec["id"] = current_max_id + 1 + idx

        insert_data = [[rec[col] for col in OUTPUT_COLUMNS] for rec in combined]
        if insert_data:
            client.insert(TABLE_NAME, insert_data, column_names=OUTPUT_COLUMNS)

        after_rows = client.query_rows(f"SELECT count(*) FROM {TABLE_NAME}")
        total_after = int(after_rows[0][0]) if after_rows and after_rows[0] else total_before + len(insert_data)
        msg = (
            f"Berhasil APPEND INSERT {len(insert_data)} baris ke {TABLE_NAME} "
            f"(ID {current_max_id + 1} - {current_max_id + len(insert_data)}). Total baris tabel sekarang: {total_after}."
        )
    else:
        if ch_conf.get("configured"):
            try:
                client = ClickHouseClientWrapper(ch_conf)
                max_rows = client.query_rows(f"SELECT max(id) FROM {TABLE_NAME}")
                raw_max = max_rows[0][0] if max_rows and max_rows[0] else 0
                current_max_id = int(raw_max or 0)
            except Exception:
                current_max_id = 0
        for idx, rec in enumerate(combined):
            rec["id"] = current_max_id + 1 + idx
        msg = (
            f"Berhasil memproses {len(combined)} baris anggaran SP2D "
            f"(Sumber Dana: {len(df_sumber_dana)}, Jenis Belanja: {len(df_jenis_belanja)}, Eselon II: {len(df_eselon_ii)})."
        )

    serialized = serialize_rows_for_json(OUTPUT_COLUMNS, combined)
    stamp = dt.datetime.now().strftime("%Y%m%d%H%M")
    csv_path, csv_filename = write_csv_to_tmp(f"anggaran_sp2d_{stamp}.csv", OUTPUT_COLUMNS, serialized)

    by_disagregasi = {
        "SUMBER DANA": len(df_sumber_dana),
        "JENIS BELANJA": len(df_jenis_belanja),
        "ESELON II": len(df_eselon_ii),
    }

    return {
        "status": "ok",
        "pipeline": "anggaran_sp2d",
        "action": action,
        "targetTable": TABLE_NAME,
        "columns": OUTPUT_COLUMNS,
        "rows": serialized,
        "total_rows": len(serialized),
        "csv_path": csv_path,
        "csv_filename": csv_filename,
        "summary": {
            "tanggal_realisasi": tahun_date,
            "total_rows": len(serialized),
            "by_disagregasi": by_disagregasi,
            "id_start": combined[0]["id"] if combined else None,
            "id_end": combined[-1]["id"] if combined else None,
            "total_pagu_anggaran": _to_int_sum(combined, "pagu_anggaran"),
            "total_sp2d_span": _to_int_sum(combined, "sp2d_span"),
            "total_sisa_dana": _to_int_sum(combined, "sisa_dana"),
            "table_rows_before": total_before if action == "sync_db" else None,
            "table_rows_after": total_after if action == "sync_db" else None,
        },
        "message": msg,
    }
