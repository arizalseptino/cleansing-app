import csv
import datetime as dt
import difflib
import json
import math
import os
import posixpath
import re
import urllib.error
import urllib.parse
import urllib.request
import uuid
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

try:
    import pandas as pd  # type: ignore
    HAS_PANDAS = True
except ImportError:
    pd = None  # type: ignore
    HAS_PANDAS = False

try:
    from rapidfuzz import fuzz as rf_fuzz, process as rf_process  # type: ignore
    HAS_RAPIDFUZZ = True
except ImportError:
    rf_fuzz = None  # type: ignore
    rf_process = None  # type: ignore
    HAS_RAPIDFUZZ = False

try:
    from clickhouse_connect import get_client as ch_get_client  # type: ignore
    HAS_CH_CONNECT = True
except ImportError:
    ch_get_client = None  # type: ignore
    HAS_CH_CONNECT = False


BASE_DIR = Path(__file__).resolve().parent.parent
REFERENCES_DIR = BASE_DIR / "references"
TMP_DIR = Path(os.environ.get("ETL_TMP_DIR", "/tmp"))


def is_missing(val: Any) -> bool:
    if val is None:
        return True
    if isinstance(val, float) and math.isnan(val):
        return True
    if HAS_PANDAS:
        try:
            if pd.isna(val):
                return True
        except Exception:
            pass
    return False


def json_safe_value(val: Any) -> Any:
    if is_missing(val):
        return None
    if isinstance(val, dt.datetime):
        return val.isoformat()
    if isinstance(val, dt.date):
        return val.isoformat()
    if isinstance(val, bool):
        return val
    if isinstance(val, int):
        return val
    if isinstance(val, float):
        if math.isnan(val) or math.isinf(val):
            return None
        return val
    if isinstance(val, (list, dict)):
        return json.dumps(val, ensure_ascii=False)
    return str(val) if not isinstance(val, str) else val


def serialize_rows_for_json(columns: List[str], rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for row in rows:
        item = {col: json_safe_value(row.get(col)) for col in columns}
        out.append(item)
    return out


def write_csv_to_tmp(download_filename: str, columns: List[str], rows: List[Dict[str, Any]]) -> Tuple[str, str]:
    TMP_DIR.mkdir(parents=True, exist_ok=True)
    safe_name = re.sub(r"[^A-Za-z0-9_.-]+", "_", download_filename).strip("_") or "etl_output.csv"
    if not safe_name.lower().endswith(".csv"):
        safe_name = f"{safe_name}.csv"
    token = f"etl_out_{uuid.uuid4().hex}.csv"
    out_path = TMP_DIR / token
    with open(out_path, "w", encoding="utf-8", newline="") as f:
        writer = csv.writer(f, lineterminator="\n")
        writer.writerow(columns)
        for row in rows:
            writer.writerow([
                "" if json_safe_value(row.get(col)) is None else json_safe_value(row.get(col))
                for col in columns
            ])
    return str(out_path), safe_name


def read_csv_dicts(path: str) -> Tuple[List[str], List[Dict[str, Optional[str]]]]:
    if not path or not os.path.exists(path):
        return [], []
    with open(path, "r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        columns = list(reader.fieldnames or [])
        rows: List[Dict[str, Optional[str]]] = []
        for row in reader:
            cleaned = {
                k: (v if v is not None and v != "" else None)
                for k, v in row.items()
                if k is not None
            }
            rows.append(cleaned)
    return columns, rows


def _col_letters_to_idx(letters: str) -> int:
    idx = 0
    for ch in letters:
        if "A" <= ch <= "Z":
            idx = idx * 26 + (ord(ch) - ord("A") + 1)
        elif "a" <= ch <= "z":
            idx = idx * 26 + (ord(ch) - ord("a") + 1)
    return max(0, idx - 1)


def _excel_serial_to_date(serial: float) -> Any:
    try:
        days = int(math.floor(serial))
        frac = serial - days
        base = dt.datetime(1899, 12, 30) if days >= 60 else dt.datetime(1899, 12, 31)
        result = base + dt.timedelta(days=days, seconds=round(frac * 86400))
        if abs(frac) < 1e-6:
            return result.date()
        return result
    except Exception:
        return serial


def _parse_xlsx_styles(zf: zipfile.ZipFile) -> set:
    date_style_indices: set = set()
    if "xl/styles.xml" not in zf.namelist():
        return date_style_indices
    try:
        root = ET.fromstring(zf.read("xl/styles.xml"))
    except Exception:
        return date_style_indices

    builtin_date_ids = set(range(14, 23)) | set(range(45, 48))
    custom_date_ids: set = set()

    for elem in root.iter():
        tag = elem.tag.split("}")[-1]
        if tag == "numFmt":
            try:
                num_fmt_id = int(elem.attrib.get("numFmtId", "-1"))
            except ValueError:
                continue
            code = (elem.attrib.get("formatCode") or "").lower()
            code_clean = re.sub(r'"[^"]*"', "", code)
            code_clean = re.sub(r"\[[^\]]*\]", "", code_clean)
            if any(tok in code_clean for tok in ("yy", "dd", "mm")) and "$" not in code_clean and "rp" not in code_clean:
                custom_date_ids.add(num_fmt_id)

    for elem in root.iter():
        if elem.tag.split("}")[-1] == "cellXfs":
            for xf_idx, xf in enumerate(elem):
                if xf.tag.split("}")[-1] != "xf":
                    continue
                try:
                    num_fmt_id = int(xf.attrib.get("numFmtId", "-1"))
                except ValueError:
                    continue
                if num_fmt_id in builtin_date_ids or num_fmt_id in custom_date_ids:
                    date_style_indices.add(xf_idx)
            break

    return date_style_indices


def _parse_shared_strings(zf: zipfile.ZipFile) -> List[str]:
    if "xl/sharedStrings.xml" not in zf.namelist():
        return []
    strings: List[str] = []
    root = ET.fromstring(zf.read("xl/sharedStrings.xml"))
    for si in root:
        if si.tag.split("}")[-1] != "si":
            continue
        parts: List[str] = []
        for elem in si.iter():
            if elem.tag.split("}")[-1] == "t" and elem.text is not None:
                parts.append(elem.text)
        strings.append("".join(parts))
    return strings


def _normalize_target_path(target: str) -> str:
    cleaned = target.lstrip("/")
    if not cleaned.startswith("xl/"):
        cleaned = posixpath.normpath(posixpath.join("xl", cleaned))
    return cleaned


def _read_xlsx_stdlib(path: str, sheet_names: Optional[Sequence[str]] = None, header: Optional[int] = 0) -> Dict[str, Any]:
    with zipfile.ZipFile(path, "r") as zf:
        if "xl/workbook.xml" not in zf.namelist():
            raise ValueError("File bukan workbook .xlsx yang valid (xl/workbook.xml tidak ditemukan).")

        wb_root = ET.fromstring(zf.read("xl/workbook.xml"))
        rels_map: Dict[str, str] = {}
        if "xl/_rels/workbook.xml.rels" in zf.namelist():
            rels_root = ET.fromstring(zf.read("xl/_rels/workbook.xml.rels"))
            for rel in rels_root:
                rid = rel.attrib.get("Id")
                target = rel.attrib.get("Target")
                if rid and target:
                    rels_map[rid] = _normalize_target_path(target)

        sheets_meta: List[Tuple[str, str]] = []
        for elem in wb_root.iter():
            if elem.tag.split("}")[-1] == "sheet":
                name = elem.attrib.get("name", "")
                rid = None
                for k, v in elem.attrib.items():
                    if k.endswith("}id") or k == "id" or k == "r:id":
                        rid = v
                        break
                target_path = rels_map.get(rid or "", "")
                if name and target_path:
                    sheets_meta.append((name, target_path))

        if sheet_names is not None:
            requested = set(sheet_names)
            available = {name for name, _ in sheets_meta}
            missing = [s for s in sheet_names if s not in available]
            if missing:
                raise ValueError(f"Sheet tidak ditemukan di file Excel: {', '.join(missing)}")
            sheets_meta = [(n, p) for n, p in sheets_meta if n in requested]

        shared_strings = _parse_shared_strings(zf)
        date_styles = _parse_xlsx_styles(zf)

        result: Dict[str, Any] = {}
        for s_name, s_path in sheets_meta:
            if s_path not in zf.namelist():
                continue
            ws_root = ET.fromstring(zf.read(s_path))
            raw_rows: List[List[Any]] = []
            max_cols = 0

            for row_el in ws_root.iter():
                if row_el.tag.split("}")[-1] != "row":
                    continue
                row_dict: Dict[int, Any] = {}
                next_col_idx = 0
                for cell in row_el:
                    if cell.tag.split("}")[-1] != "c":
                        continue
                    ref = cell.attrib.get("r", "")
                    m_col = re.match(r"^([A-Za-z]+)", ref)
                    col_idx = _col_letters_to_idx(m_col.group(1)) if m_col else next_col_idx
                    next_col_idx = col_idx + 1

                    c_type = cell.attrib.get("t", "")
                    s_attr = cell.attrib.get("s")
                    style_idx = int(s_attr) if s_attr and s_attr.isdigit() else -1

                    val_el = None
                    is_el = None
                    for child in cell:
                        ctag = child.tag.split("}")[-1]
                        if ctag == "v":
                            val_el = child
                        elif ctag == "is":
                            is_el = child

                    val: Any = None
                    if c_type == "inlineStr" and is_el is not None:
                        parts = [t.text for t in is_el.iter() if t.tag.split("}")[-1] == "t" and t.text is not None]
                        val = "".join(parts)
                    elif val_el is not None and val_el.text is not None:
                        raw_text = val_el.text
                        if c_type == "s":
                            try:
                                val = shared_strings[int(raw_text)]
                            except Exception:
                                val = raw_text
                        elif c_type == "b":
                            val = raw_text == "1"
                        elif c_type in ("str", "e"):
                            val = raw_text
                        else:
                            if style_idx in date_styles:
                                try:
                                    val = _excel_serial_to_date(float(raw_text))
                                except ValueError:
                                    val = raw_text
                            else:
                                if re.fullmatch(r"-?\d+", raw_text.strip()):
                                    val = int(raw_text.strip())
                                else:
                                    try:
                                        f_val = float(raw_text)
                                        val = int(f_val) if f_val.is_integer() and "." not in raw_text else f_val
                                    except ValueError:
                                        val = raw_text
                    row_dict[col_idx] = val
                    if col_idx + 1 > max_cols:
                        max_cols = col_idx + 1

                if row_dict:
                    row_arr = [row_dict.get(i) for i in range(max_cols)]
                    raw_rows.append(row_arr)

            # Pad all rows to max_cols
            padded_rows = [r + [None] * (max_cols - len(r)) for r in raw_rows]

            if header is None:
                result[s_name] = padded_rows
            else:
                if not padded_rows or header >= len(padded_rows):
                    result[s_name] = {"columns": [], "rows": []}
                else:
                    raw_headers = padded_rows[header]
                    seen: Dict[str, int] = {}
                    cols: List[str] = []
                    for i, h in enumerate(raw_headers):
                        base = str(h).strip() if h is not None and str(h).strip() else f"Unnamed: {i}"
                        if base in seen:
                            seen[base] += 1
                            cols.append(f"{base}.{seen[base]}")
                        else:
                            seen[base] = 0
                            cols.append(base)
                    dict_rows: List[Dict[str, Any]] = []
                    for r in padded_rows[header + 1:]:
                        if all(v is None or (isinstance(v, str) and not v.strip()) for v in r):
                            continue
                        dict_rows.append({cols[i]: (r[i] if i < len(r) else None) for i in range(len(cols))})
                    result[s_name] = {"columns": cols, "rows": dict_rows}
        return result


def read_excel_sheets(
    path: str,
    sheet_names: Optional[Sequence[str]] = None,
    header: Optional[int] = 0,
) -> Dict[str, Any]:
    if HAS_PANDAS:
        try:
            target = list(sheet_names) if sheet_names is not None else None
            dfs = pd.read_excel(path, sheet_name=target, header=header)
            if not isinstance(dfs, dict):
                dfs = {"Sheet1": dfs}
            out: Dict[str, Any] = {}
            for name, df in dfs.items():
                if header is None:
                    rows_list = []
                    for _, s in df.iterrows():
                        rows_list.append([None if is_missing(v) else v for v in s.tolist()])
                    out[name] = rows_list
                else:
                    cols = [str(c) for c in df.columns.tolist()]
                    records = []
                    for rec in df.to_dict("records"):
                        records.append({k: (None if is_missing(v) else v) for k, v in rec.items()})
                    out[name] = {"columns": cols, "rows": records}
            return out
        except ImportError:
            pass
    return _read_xlsx_stdlib(path, sheet_names=sheet_names, header=header)


def _sorted_token_string(text: str) -> str:
    tokens = re.findall(r"[0-9a-zA-Z]+", text.lower())
    tokens.sort()
    return " ".join(tokens)


def token_sort_ratio(a: str, b: str) -> float:
    if HAS_RAPIDFUZZ and rf_fuzz is not None:
        return float(rf_fuzz.token_sort_ratio(a, b))
    sa = _sorted_token_string(a)
    sb = _sorted_token_string(b)
    if not sa and not sb:
        return 100.0
    if not sa or not sb:
        return 0.0
    return difflib.SequenceMatcher(None, sa, sb).ratio() * 100.0


def fuzzy_extract_one(query: str, choices: Sequence[str]) -> Optional[Tuple[str, float, int]]:
    if not choices:
        return None
    if HAS_RAPIDFUZZ and rf_process is not None and rf_fuzz is not None:
        return rf_process.extractOne(query, choices, scorer=rf_fuzz.token_sort_ratio)
    best_choice = None
    best_score = -1.0
    best_idx = -1
    for idx, choice in enumerate(choices):
        score = token_sort_ratio(query, choice)
        if score > best_score:
            best_score = score
            best_choice = choice
            best_idx = idx
    if best_choice is None:
        return None
    return (best_choice, best_score, best_idx)


def get_clickhouse_config() -> Dict[str, Any]:
    raw_url = (os.environ.get("NUXT_CLICKHOUSE_URL") or "").strip()
    user = (os.environ.get("NUXT_CLICKHOUSE_USER") or "default").strip() or "default"
    password = os.environ.get("NUXT_CLICKHOUSE_PASSWORD") or ""
    if not raw_url:
        return {"configured": False, "url": "", "host": "localhost", "port": 8123, "secure": False, "username": user, "password": password}
    parsed = urllib.parse.urlparse(raw_url if "://" in raw_url else f"http://{raw_url}")
    secure = parsed.scheme == "https"
    host = parsed.hostname or "localhost"
    port = parsed.port or (8443 if secure else 8123)
    return {
        "configured": True,
        "url": raw_url.rstrip("/"),
        "host": host,
        "port": port,
        "secure": secure,
        "username": user,
        "password": password,
    }


class ClickHouseClientWrapper:
    def __init__(self, conf: Optional[Dict[str, Any]] = None):
        self.conf = conf or get_clickhouse_config()
        if not self.conf.get("configured"):
            raise RuntimeError("NUXT_CLICKHOUSE_URL belum dikonfigurasi di environment server.")
        self._native = None
        if HAS_CH_CONNECT and ch_get_client is not None:
            self._native = ch_get_client(
                host=self.conf["host"],
                port=self.conf["port"],
                username=self.conf["username"],
                password=self.conf["password"],
                secure=self.conf["secure"],
            )

    def _http_request(self, query: str, body: Optional[bytes] = None) -> bytes:
        base = self.conf["url"]
        sep = "&" if "?" in base else "?"
        url = f"{base}{sep}{urllib.parse.urlencode({'query': query})}"
        req = urllib.request.Request(url, data=body, method="POST")
        req.add_header("X-ClickHouse-User", self.conf["username"])
        if self.conf["password"]:
            req.add_header("X-ClickHouse-Key", self.conf["password"])
        req.add_header("Content-Type", "application/json; charset=utf-8")
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                return resp.read()
        except urllib.error.HTTPError as exc:
            err_body = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"ClickHouse HTTP {exc.code}: {err_body}") from exc

    def query_rows(self, sql: str) -> List[List[Any]]:
        if self._native is not None:
            return self._native.query(sql).result_rows
        raw = self._http_request(f"{sql.rstrip(';')} FORMAT JSONCompact")
        payload = json.loads(raw.decode("utf-8"))
        return payload.get("data", [])

    def command(self, sql: str) -> None:
        if self._native is not None:
            self._native.command(sql)
            return
        self._http_request(sql)

    def insert(self, table: str, rows: List[List[Any]], column_names: List[str]) -> None:
        if not rows:
            return
        if self._native is not None:
            self._native.insert(table, rows, column_names=column_names)
            return
        lines = []
        for row in rows:
            obj = {col: json_safe_value(row[idx]) for idx, col in enumerate(column_names)}
            lines.append(json.dumps(obj, ensure_ascii=False))
        payload = ("\n".join(lines) + "\n").encode("utf-8")
        cols_sql = ", ".join(quote_ch_ident(col) for col in column_names)
        self._http_request(f"INSERT INTO {table} ({cols_sql}) FORMAT JSONEachRow", body=payload)


VALID_CUSTOM_ENGINES = {"MergeTree", "ReplacingMergeTree"}
VALID_DB_IDENT_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,63}$")
VALID_TABLE_IDENT_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_]{0,63}$")
SYSTEM_DATABASES = {"system", "information_schema", "bersihdata"}


def quote_ch_ident(identifier: str) -> str:
    return "`" + identifier.replace("\\", "\\\\").replace("`", "\\`") + "`"


def validate_custom_target_params(
    target_db: Optional[str],
    target_table: Optional[str],
    engine: Optional[str],
    order_by: Optional[str],
    column_schema: List[Dict[str, str]],
) -> Optional[Tuple[str, str, str, Optional[str]]]:
    db = (target_db or "").strip()
    tbl = (target_table or "").strip()
    if not db and not tbl:
        return None
    if not db or not tbl:
        raise ValueError("Parameter target_db dan target_table wajib diisi bersamaan.")
    if not VALID_DB_IDENT_RE.fullmatch(db):
        raise ValueError("Nama database tujuan tidak valid.")
    if db.lower() in SYSTEM_DATABASES:
        raise ValueError("Database sistem atau aplikasi tidak dapat dipilih sebagai tujuan.")
    if not VALID_TABLE_IDENT_RE.fullmatch(tbl):
        raise ValueError("Nama tabel tujuan harus diawali huruf, maksimal 64 karakter, dan hanya berisi huruf, angka, atau garis bawah.")

    chosen_engine = (engine or "MergeTree").strip() or "MergeTree"
    if chosen_engine not in VALID_CUSTOM_ENGINES:
        raise ValueError("Engine tabel harus MergeTree atau ReplacingMergeTree.")

    chosen_order = (order_by or "").strip() or None
    if chosen_order is not None:
        matched = next((col for col in column_schema if col.get("name") == chosen_order), None)
        if not matched:
            raise ValueError(f"Kolom ORDER BY '{chosen_order}' tidak ditemukan pada skema hasil ETL.")
        if "Nullable(" in (matched.get("type") or ""):
            raise ValueError(f"Kolom ORDER BY '{chosen_order}' bertipe Nullable dan tidak dapat dipilih.")

    return db, tbl, chosen_engine, chosen_order


def sync_to_custom_table(
    client: ClickHouseClientWrapper,
    target_db: str,
    target_table: str,
    engine: str,
    order_by: Optional[str],
    column_schema: List[Dict[str, str]],
    rows_payload: List[List[Any]],
) -> str:
    validated = validate_custom_target_params(target_db, target_table, engine, order_by, column_schema)
    if validated is None:
        raise ValueError("Target database dan tabel tidak valid.")
    db, tbl, chosen_engine, chosen_order = validated

    existing = client.query_rows(
        f"SELECT name FROM system.tables WHERE database = '{db}' AND name = '{tbl}' LIMIT 1"
    )
    if existing:
        raise ValueError(f"Tabel {db}.{tbl} sudah ada. Pilih nama tabel lain agar tabel yang sudah ada tidak diubah.")

    db_q = quote_ch_ident(db)
    tbl_q = quote_ch_ident(tbl)
    client.command(f"CREATE DATABASE IF NOT EXISTS {db_q}")

    col_defs = ", ".join(f"{quote_ch_ident(col['name'])} {col['type']}" for col in column_schema)
    order_clause = quote_ch_ident(chosen_order) if chosen_order else "tuple()"
    create_sql = f"CREATE TABLE {db_q}.{tbl_q} ({col_defs}) ENGINE = {chosen_engine} ORDER BY {order_clause}"
    client.command(create_sql)

    col_names = [col["name"] for col in column_schema]
    if rows_payload:
        client.insert(f"{db}.{tbl}", rows_payload, column_names=col_names)

    return f"{db}.{tbl}"

