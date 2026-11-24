import base64
import datetime as dt
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, List, Optional, Tuple

from .common import (
    HAS_PANDAS,
    REFERENCES_DIR,
    ClickHouseClientWrapper,
    get_clickhouse_config,
    is_missing,
    pd,
    read_csv_dicts,
    serialize_rows_for_json,
    sync_to_custom_table,
    validate_custom_target_params,
    write_csv_to_tmp,
)

try:
    from elasticsearch import Elasticsearch  # type: ignore
    HAS_ELASTICSEARCH = True
except ImportError:
    Elasticsearch = None  # type: ignore
    HAS_ELASTICSEARCH = False

TABLE_NAME = "dataset.course_sibangkom"

SELECTED_COLUMNS = [
    "uuid",
    "statusMateri",
    "statusProgressMateri",
    "totalTrophy",
    "statusJurnal",
    "skor",
    "sikapPerilaku",
    "evaluasiPilihanGanda",
    "evaluasiEssay",
    "isSelesai",
    "isSelesaiPilihanGanda",
    "isSelesaiEssay",
    "isActive",
    "isRemedial",
    "createAt",
    "updatedAt",
    "createdBy",
    "openedCourseAt",
    "closedCourseAt",
    "openedEvaluationAt",
    "closedEvaluationAt",
    "ip",
    "masterTypes.namaType",
    "angkatan.nama",
    "pegawaiDto.nip",
    "pegawaiDto.nama",
    "pegawaiDto.pnsId",
    "pegawaiDto.golRuangAkhir",
    "pegawaiDto.jabatanNama",
    "pegawaiDto.statusPegawai",
    "pegawaiDto.instansiIndukNama",
    "pegawaiDto.tempatLahir",
    "pegawaiDto.tglLahir",
    "pegawaiDto.jenisKelamin",
    "pegawaiDto.eselon",
    "pegawaiDto.eselonLevel",
    "pegawaiDto.tmtGolAkhir",
    "pegawaiDto.instansiKerjaNama",
    "pegawaiDto.jenisJabatan",
    "pegawaiDto.gelarDepan",
    "pegawaiDto.gelarBelakang",
    "pegawaiDto.pendidikanTerakhirNama",
    "pegawaiDto.tkPendidikanTerakhir",
    "pegawaiDto.unorIndukNama",
    "pegawaiDto.unorNama",
    "sertifikatDto.nomorUrutSertifikat",
    "sertifikatDto.nomorSertifikat",
    "sertifikatDto.pathSertifikat",
    "sertifikatDto.penandaTanganPertama",
    "sertifikatDto.penandaTanganKedua",
    "sertifikatDto.tglTtePertama",
    "sertifikatDto.tglTteKedua",
]


def _flatten_dict(d: Dict[str, Any], parent_key: str = "") -> Dict[str, Any]:
    items: Dict[str, Any] = {}
    for k, v in d.items():
        new_key = f"{parent_key}.{k}" if parent_key else str(k)
        if isinstance(v, dict):
            items.update(_flatten_dict(v, new_key))
        else:
            items[new_key] = v
    return items


class _EsRestClient:
    def __init__(self, url: str, user: str = "", password: str = ""):
        self.base_url = url.rstrip("/")
        self.user = user
        self.password = password
        self._native = None
        if HAS_ELASTICSEARCH and Elasticsearch is not None:
            auth = (user, password) if user or password else None
            self._native = Elasticsearch(self.base_url, basic_auth=auth, request_timeout=120)

    def _http_post(self, path: str, body: Dict[str, Any]) -> Dict[str, Any]:
        full_url = f"{self.base_url}{path}"
        data = json.dumps(body).encode("utf-8")
        req = urllib.request.Request(full_url, data=data, method="POST")
        req.add_header("Content-Type", "application/json; charset=utf-8")
        if self.user or self.password:
            creds = base64.b64encode(f"{self.user}:{self.password}".encode("utf-8")).decode("ascii")
            req.add_header("Authorization", f"Basic {creds}")
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            err_body = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"Elasticsearch HTTP {exc.code}: {err_body}") from exc

    def search_initial(self, index: str, scroll: str, body: Dict[str, Any]) -> Dict[str, Any]:
        if self._native is not None:
            return dict(self._native.search(index=index, scroll=scroll, body=body))
        qs = urllib.parse.urlencode({"scroll": scroll})
        return self._http_post(f"/{urllib.parse.quote(index)}/_search?{qs}", body)

    def scroll(self, scroll_id: str, scroll: str) -> Dict[str, Any]:
        if self._native is not None:
            return dict(self._native.scroll(scroll_id=scroll_id, scroll=scroll))
        return self._http_post("/_search/scroll", {"scroll": scroll, "scroll_id": scroll_id})


def _get_es_config() -> Tuple[str, str, str]:
    url = (os.environ.get("ELASTICSEARCH_URL") or os.environ.get("NUXT_ELASTICSEARCH_URL") or "").strip()
    user = (os.environ.get("ELASTICSEARCH_USER") or os.environ.get("NUXT_ELASTICSEARCH_USER") or "").strip()
    password = os.environ.get("ELASTICSEARCH_PASSWORD") or os.environ.get("NUXT_ELASTICSEARCH_PASSWORD") or ""
    return url, user, password


def _load_nip_reference() -> set:
    ref_path = REFERENCES_DIR / "course_reference_nip.csv"
    if not ref_path.exists():
        return set()
    cols, rows = read_csv_dicts(str(ref_path))
    if "nip" not in cols:
        return set()
    return {str(r["nip"]).strip() for r in rows if r.get("nip")}


def _sanitize_col(col: str) -> str:
    return re.sub(r"[^A-Za-z0-9_]", "_", col)


SANITIZED_TO_SELECTED = {_sanitize_col(col): col for col in SELECTED_COLUMNS}


def _normalize_es_doc(doc: Dict[str, Any]) -> Dict[str, Any]:
    raw_source = doc.get("_source")
    if isinstance(raw_source, dict):
        source_obj = dict(raw_source)
        if doc.get("_id") is not None and not source_obj.get("uuid"):
            source_obj["uuid"] = doc["_id"]
        return _flatten_dict(source_obj)
    return _flatten_dict(doc)


def _load_json_docs(input_path: str) -> List[Dict[str, Any]]:
    with open(input_path, "r", encoding="utf-8-sig") as f:
        content = f.read().strip()

    if not content:
        return []

    raw_docs: List[Any] = []
    try:
        parsed = json.loads(content)
        if isinstance(parsed, list):
            raw_docs = parsed
        elif isinstance(parsed, dict):
            hits_obj = parsed.get("hits")
            if isinstance(hits_obj, dict) and isinstance(hits_obj.get("hits"), list):
                raw_docs = hits_obj["hits"]
            elif isinstance(hits_obj, list):
                raw_docs = hits_obj
            else:
                raw_docs = [parsed]
        else:
            raise ValueError(
                "Format file JSON harus berupa array objek ([...]), NDJSON, atau respons Elasticsearch (hits.hits)."
            )
    except json.JSONDecodeError:
        for line_no, raw_line in enumerate(content.splitlines(), start=1):
            line = raw_line.strip()
            if not line:
                continue
            try:
                item = json.loads(line)
            except json.JSONDecodeError as exc:
                raise ValueError(
                    f"Format file JSON/NDJSON tidak valid pada baris {line_no}: {exc.msg}"
                ) from exc
            if isinstance(item, dict):
                hits_obj = item.get("hits")
                if isinstance(hits_obj, dict) and isinstance(hits_obj.get("hits"), list):
                    raw_docs.extend(hits_obj["hits"])
                else:
                    raw_docs.append(item)
            elif isinstance(item, list):
                raw_docs.extend(item)
            else:
                raise ValueError(f"Baris {line_no} pada file NDJSON harus berupa objek JSON.")

    return [_normalize_es_doc(doc) for doc in raw_docs if isinstance(doc, dict)]


def _normalize_csv_row(row: Dict[str, Any]) -> Dict[str, Any]:
    cleaned: Dict[str, Any] = {}
    for k, v in row.items():
        if k is None:
            continue
        key = str(k).strip()
        if not key:
            continue
        cleaned[key] = None if is_missing(v) else v

    # Support CSV exported from sanitized ClickHouse columns (e.g. masterTypes_namaType -> masterTypes.namaType)
    for k, v in list(cleaned.items()):
        mapped = SANITIZED_TO_SELECTED.get(k)
        if mapped and mapped not in cleaned:
            cleaned[mapped] = v
    return cleaned


def _load_csv_docs(input_path: str) -> List[Dict[str, Any]]:
    if HAS_PANDAS and pd is not None:
        try:
            df = pd.read_csv(input_path, dtype=str, encoding="utf-8-sig", keep_default_na=True)
        except pd.errors.EmptyDataError:
            return []
        raw_rows = df.where(pd.notnull(df), None).to_dict(orient="records")
        return [_normalize_csv_row(row) for row in raw_rows if isinstance(row, dict)]

    _, rows = read_csv_dicts(input_path)
    return [_normalize_csv_row(row) for row in rows]


def _parse_updated_at(value: Any) -> Optional[dt.datetime]:
    if value is None or is_missing(value):
        return None
    if isinstance(value, dt.datetime):
        return value.replace(tzinfo=dt.timezone.utc) if value.tzinfo is None else value.astimezone(dt.timezone.utc)
    if isinstance(value, dt.date):
        return dt.datetime(value.year, value.month, value.day, tzinfo=dt.timezone.utc)
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        ts = float(value)
        if abs(ts) >= 1e11:
            ts /= 1000.0
        try:
            return dt.datetime.fromtimestamp(ts, tz=dt.timezone.utc)
        except (OSError, OverflowError, ValueError):
            return None

    text = str(value).strip()
    if not text:
        return None
    if re.fullmatch(r"\d{10,13}", text):
        ts = float(text)
        if len(text) >= 13:
            ts /= 1000.0
        try:
            return dt.datetime.fromtimestamp(ts, tz=dt.timezone.utc)
        except (OSError, OverflowError, ValueError):
            return None

    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", text):
        try:
            d = dt.date.fromisoformat(text)
            return dt.datetime(d.year, d.month, d.day, tzinfo=dt.timezone.utc)
        except ValueError:
            return None

    normalized = text[:-1] + "+00:00" if text.endswith(("Z", "z")) else text
    if " " in normalized and "T" not in normalized:
        normalized = normalized.replace(" ", "T", 1)
    try:
        parsed = dt.datetime.fromisoformat(normalized)
        return parsed.replace(tzinfo=dt.timezone.utc) if parsed.tzinfo is None else parsed.astimezone(dt.timezone.utc)
    except ValueError:
        return None


def _filter_by_updated_at(
    rows: List[Dict[str, Any]],
    start_d: Optional[dt.date],
    end_d: Optional[dt.date],
) -> List[Dict[str, Any]]:
    if start_d is None and end_d is None:
        return rows

    gte_dt = dt.datetime(start_d.year, start_d.month, start_d.day, tzinfo=dt.timezone.utc) if start_d else None
    if end_d is not None:
        end_next = end_d + dt.timedelta(days=1)
        lt_dt = dt.datetime(end_next.year, end_next.month, end_next.day, tzinfo=dt.timezone.utc)
    else:
        lt_dt = None

    filtered: List[Dict[str, Any]] = []
    for row in rows:
        parsed_dt = _parse_updated_at(row.get("updatedAt"))
        if parsed_dt is None:
            continue
        if gte_dt is not None and parsed_dt < gte_dt:
            continue
        if lt_dt is not None and parsed_dt >= lt_dt:
            continue
        filtered.append(row)
    return filtered


def _ensure_table(client: ClickHouseClientWrapper, columns: List[str]) -> None:
    client.command("CREATE DATABASE IF NOT EXISTS dataset")
    col_defs = []
    for col in columns:
        safe = _sanitize_col(col)
        if col == "uuid":
            col_defs.append(f"`{safe}` String")
        else:
            col_defs.append(f"`{safe}` Nullable(String)")
    order_col = _sanitize_col("uuid") if "uuid" in columns else _sanitize_col(columns[0])
    client.command(
        f"""
        CREATE TABLE IF NOT EXISTS {TABLE_NAME} (
            {', '.join(col_defs)}
        ) ENGINE = MergeTree
        ORDER BY `{order_col}`
        """
    )


def run(
    action: str = "preview",
    input_path: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    target_db: Optional[str] = None,
    target_table: Optional[str] = None,
    engine: Optional[str] = None,
    order_by: Optional[str] = None,
    **_: Any,
) -> Dict[str, Any]:
    start_d: Optional[dt.date] = None
    end_d: Optional[dt.date] = None

    if start_date:
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", start_date):
            raise ValueError("Format Dari Tanggal harus YYYY-MM-DD.")
        start_d = dt.date.fromisoformat(start_date)

    if end_date:
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", end_date):
            raise ValueError("Format Sampai Tanggal harus YYYY-MM-DD.")
        end_d = dt.date.fromisoformat(end_date)

    if start_d is not None and end_d is not None and start_d > end_d:
        raise ValueError("Dari Tanggal tidak boleh lebih besar dari Sampai Tanggal.")

    is_file_mode = bool(input_path and str(input_path).strip())

    if is_file_mode:
        resolved_input = str(input_path).strip()
        if not os.path.exists(resolved_input):
            raise ValueError("File export lokal tidak ditemukan di server.")
        ext = os.path.splitext(resolved_input)[1].lower()
        if ext == ".json":
            flattened_rows = _load_json_docs(resolved_input)
        elif ext == ".csv":
            flattened_rows = _load_csv_docs(resolved_input)
        else:
            raise ValueError("Format file tidak didukung untuk Course Elasticsearch. Gunakan .json atau .csv.")

        flattened_rows = _filter_by_updated_at(flattened_rows, start_d, end_d)
        total_fetched = len(flattened_rows)
    else:
        if start_d is None or end_d is None:
            raise ValueError("Rentang tanggal (Dari Tanggal dan Sampai Tanggal) wajib diisi untuk Course Elasticsearch.")

        es_url, es_user, es_pass = _get_es_config()
        if not es_url:
            raise RuntimeError(
                "Konfigurasi ELASTICSEARCH_URL belum diatur di environment server (.env). Atur ELASTICSEARCH_URL terlebih dahulu."
            )

        es = _EsRestClient(es_url, es_user, es_pass)
        gte_iso = f"{start_d.isoformat()}T00:00:00.000Z"
        lt_iso = f"{(end_d + dt.timedelta(days=1)).isoformat()}T00:00:00.000Z"

        all_docs: List[Dict[str, Any]] = []
        scroll_size = 10000
        scroll_timeout = "5m"
        max_retries = 5
        max_consecutive_errors = 5

        page = es.search_initial(
            index="course",
            scroll=scroll_timeout,
            body={
                "size": scroll_size,
                "query": {
                    "range": {
                        "updatedAt": {
                            "gte": gte_iso,
                            "lt": lt_iso,
                        }
                    }
                },
            },
        )
        sid = page.get("_scroll_id", "")
        scroll_hits = page.get("hits", {}).get("hits", [])
        all_docs.extend(scroll_hits)

        batch_num = 2
        consecutive_errors = 0
        while len(scroll_hits) > 0 and sid:
            retry_count = 0
            success = False
            while retry_count < max_retries and not success:
                try:
                    page = es.scroll(scroll_id=sid, scroll=scroll_timeout)
                    sid = page.get("_scroll_id", sid)
                    scroll_hits = page.get("hits", {}).get("hits", [])
                    if len(scroll_hits) > 0:
                        all_docs.extend(scroll_hits)
                        consecutive_errors = 0
                        batch_num += 1
                    success = True
                    time.sleep(0.2)
                except Exception as exc:
                    retry_count += 1
                    consecutive_errors += 1
                    if retry_count < max_retries:
                        wait_time = retry_count * 2
                        print(
                            f"Batch {batch_num} retry {retry_count}/{max_retries} in {wait_time}s: {exc}",
                            file=sys.stderr,
                        )
                        time.sleep(wait_time)
                    else:
                        if consecutive_errors >= max_consecutive_errors:
                            scroll_hits = []
                        break

            if not success and consecutive_errors < max_consecutive_errors:
                try:
                    page = es.scroll(scroll_id=sid, scroll=scroll_timeout)
                    sid = page.get("_scroll_id", sid)
                    scroll_hits = page.get("hits", {}).get("hits", [])
                except Exception:
                    scroll_hits = []

        flattened_rows = [_flatten_dict(doc.get("_source", {})) for doc in all_docs if isinstance(doc, dict)]
        total_fetched = len(flattened_rows)

    # Filter PPPK (Cell 12 parity)
    pppk_rows = [r for r in flattened_rows if r.get("masterTypes.namaType") == "PPPK"]
    total_pppk = len(pppk_rows)

    # Anti-join NIP reference (Cell 17 parity)
    nip_ref = _load_nip_reference()
    if nip_ref:
        filtered_rows = [r for r in pppk_rows if str(r.get("pegawaiDto.nip") or "").strip() not in nip_ref]
    else:
        filtered_rows = pppk_rows

    present_keys = set()
    for r in filtered_rows:
        present_keys.update(r.keys())

    available_columns = [c for c in SELECTED_COLUMNS if c in present_keys]
    if not available_columns:
        available_columns = list(SELECTED_COLUMNS)

    column_schema = [
        {"name": col, "type": "String" if col == "uuid" else "Nullable(String)"}
        for col in available_columns
    ]
    custom_target = validate_custom_target_params(target_db, target_table, engine, order_by, column_schema)
    effective_target = f"{custom_target[0]}.{custom_target[1]}" if custom_target else TABLE_NAME

    selected_rows = [{col: r.get(col) for col in available_columns} for r in filtered_rows]
    serialized = serialize_rows_for_json(available_columns, selected_rows)

    inserted_count = 0
    if action == "sync_db" and custom_target is not None:
        client = ClickHouseClientWrapper(get_clickhouse_config())
        payload = [
            [
                ("" if col == "uuid" else None) if row.get(col) is None else str(row.get(col))
                for col in available_columns
            ]
            for row in serialized
        ]
        effective_target = sync_to_custom_table(
            client=client,
            target_db=custom_target[0],
            target_table=custom_target[1],
            engine=custom_target[2],
            order_by=custom_target[3],
            column_schema=column_schema,
            rows_payload=payload,
        )
        inserted_count = len(payload)
        msg = f"Berhasil membuat tabel baru {effective_target} ({custom_target[2]}) dan memasukkan {inserted_count} baris hasil ETL."
    elif action == "sync_db" and serialized:
        client = ClickHouseClientWrapper(get_clickhouse_config())
        _ensure_table(client, available_columns)
        db_cols = [_sanitize_col(c) for c in available_columns]
        payload = [
            [
                ("" if col == "uuid" else None) if row.get(col) is None else str(row.get(col))
                for col in available_columns
            ]
            for row in serialized
        ]
        client.insert(TABLE_NAME, payload, column_names=db_cols)
        inserted_count = len(payload)
        msg = f"Berhasil menyinkronkan {inserted_count} dokumen Course Elasticsearch ke {TABLE_NAME}."
    elif action == "sync_db":
        msg = "Tidak ada baris yang memenuhi filter untuk dimasukkan ke ClickHouse."
    elif is_file_mode:
        if start_date and end_date:
            date_label = f" ({start_date} s.d. {end_date})"
        elif start_date:
            date_label = f" (>= {start_date})"
        elif end_date:
            date_label = f" (<= {end_date})"
        else:
            date_label = " (semua tanggal)"
        msg = (
            f"Berhasil memproses {total_fetched} dokumen dari file export{date_label}, "
            f"{total_pppk} PPPK, {len(serialized)} baris setelah anti-join NIP."
        )
    else:
        msg = (
            f"Berhasil mengambil {total_fetched} dokumen ES ({start_date} s.d. {end_date}), "
            f"{total_pppk} PPPK, {len(serialized)} baris setelah anti-join NIP."
        )

    stamp = dt.datetime.now().strftime("%Y%m%d%H%M")
    csv_path, csv_filename = write_csv_to_tmp(f"course_es_{stamp}.csv", available_columns, serialized)

    return {
        "status": "ok",
        "pipeline": "course_es",
        "action": action,
        "targetTable": effective_target,
        "columns": available_columns,
        "column_schema": column_schema,
        "rows": serialized,
        "total_rows": len(serialized),
        "csv_path": csv_path,
        "csv_filename": csv_filename,
        "summary": {
            "source_mode": "file" if is_file_mode else "api",
            "start_date": start_date,
            "end_date": end_date,
            "total_es_docs": total_fetched,
            "total_pppk": total_pppk,
            "nip_reference_count": len(nip_ref),
            "total_after_filter": len(serialized),
            "inserted_count": inserted_count,
            "selected_columns_count": len(available_columns),
        },
        "message": msg,
    }
