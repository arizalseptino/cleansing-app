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
    REFERENCES_DIR,
    ClickHouseClientWrapper,
    get_clickhouse_config,
    read_csv_dicts,
    serialize_rows_for_json,
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
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    **_: Any,
) -> Dict[str, Any]:
    if not start_date or not end_date:
        raise ValueError("Rentang tanggal (Dari Tanggal dan Sampai Tanggal) wajib diisi untuk Course Elasticsearch.")
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", start_date) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", end_date):
        raise ValueError("Format tanggal harus YYYY-MM-DD.")

    start_d = dt.date.fromisoformat(start_date)
    end_d = dt.date.fromisoformat(end_date)
    if start_d > end_d:
        raise ValueError("Dari Tanggal tidak boleh lebih besar dari Sampai Tanggal.")

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
        filtered_rows = [r for r in pppk_rows if str(r.get("pegawaiDto.nip") or "") not in nip_ref]
    else:
        filtered_rows = pppk_rows

    present_keys = set()
    for r in filtered_rows:
        present_keys.update(r.keys())

    available_columns = [c for c in SELECTED_COLUMNS if c in present_keys]
    if not available_columns:
        available_columns = list(SELECTED_COLUMNS)

    selected_rows = [{col: r.get(col) for col in available_columns} for r in filtered_rows]
    serialized = serialize_rows_for_json(available_columns, selected_rows)

    inserted_count = 0
    if action == "sync_db" and serialized:
        client = ClickHouseClientWrapper(get_clickhouse_config())
        _ensure_table(client, available_columns)
        db_cols = [_sanitize_col(c) for c in available_columns]
        payload = [
            [
                None if row.get(col) is None else str(row.get(col))
                for col in available_columns
            ]
            for row in serialized
        ]
        client.insert(TABLE_NAME, payload, column_names=db_cols)
        inserted_count = len(payload)
        msg = f"Berhasil menyinkronkan {inserted_count} dokumen Course Elasticsearch ke {TABLE_NAME}."
    elif action == "sync_db":
        msg = "Tidak ada baris yang memenuhi filter untuk dimasukkan ke ClickHouse."
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
        "targetTable": TABLE_NAME,
        "columns": available_columns,
        "rows": serialized,
        "total_rows": len(serialized),
        "csv_path": csv_path,
        "csv_filename": csv_filename,
        "summary": {
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
