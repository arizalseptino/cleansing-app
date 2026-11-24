import datetime as dt
import os
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

from .common import (
    REFERENCES_DIR,
    ClickHouseClientWrapper,
    fuzzy_extract_one,
    get_clickhouse_config,
    is_missing,
    read_csv_dicts,
    read_excel_sheets,
    serialize_rows_for_json,
    sync_to_custom_table,
    validate_custom_target_params,
    write_csv_to_tmp,
)

TABLE_NAME = "db_vpl.vpl_series_atax"
FUZZY_THRESHOLD = 85

COLS_SCHEMA = [
    "id",
    "series_vpl",
    "nama_peserta",
    "email",
    "jenis_kelamin",
    "jabatan_raw",
    "instansi_raw",
    "jenis_instansi",
    "asal_daerah",
    "jabatan_clean",
    "instansi_clean",
    "tanggal_webinar",
    "judul_webinar",
    "tahun_kegiatan",
]

OUTPUT_SCHEMA = [
    {"name": "id", "type": "UInt32"},
    {"name": "series_vpl", "type": "Nullable(String)"},
    {"name": "nama_peserta", "type": "Nullable(String)"},
    {"name": "email", "type": "Nullable(String)"},
    {"name": "jenis_kelamin", "type": "Nullable(String)"},
    {"name": "jabatan_raw", "type": "Nullable(String)"},
    {"name": "instansi_raw", "type": "Nullable(String)"},
    {"name": "jenis_instansi", "type": "Nullable(String)"},
    {"name": "asal_daerah", "type": "Nullable(String)"},
    {"name": "jabatan_clean", "type": "Nullable(String)"},
    {"name": "instansi_clean", "type": "Nullable(String)"},
    {"name": "tanggal_webinar", "type": "Nullable(Date)"},
    {"name": "judul_webinar", "type": "Nullable(String)"},
    {"name": "tahun_kegiatan", "type": "UInt16"},
]

STR_COLS: Set[str] = {
    "series_vpl",
    "nama_peserta",
    "email",
    "jenis_kelamin",
    "jabatan_raw",
    "instansi_raw",
    "jenis_instansi",
    "asal_daerah",
    "jabatan_clean",
    "instansi_clean",
    "judul_webinar",
}

MASTER_JABATAN_PELAKSANA = [
    "Penata Layanan Operasional",
    "Pengadministrasi Perkantoran",
    "Operator Layanan Operasional",
    "Pengelola Layanan Operasional",
    "Penelaah Teknis Kebijakan",
    "Pengolah Data dan Informasi",
    "Penata Kelola Sistem dan Teknologi Informasi",
    "Pengelola Penataan Sarana dan Prasarana",
    "Pengelola Keprotokolan",
    "Pengelola Surat",
    "Pengelola Umum Operasional",
    "Pranata Trantibum",
    "Pelaksana",
]

ABBREVIATION_MAP = {
    r"\bsdma\b": "Sumber Daya Manusia Aparatur",
    r"\bsdm\b": "Sumber Daya Manusia",
    r"\bpeh\b": "Pengendali Ekosistem Hutan",
    r"\bjph\b": "Jaminan Produk Halal",
    r"\bpranata kom\b": "Pranata Komputer",
    r"\bprakom\b": "Pranata Komputer",
    r"\bpbj\b": "Pengadaan Barang/Jasa",
    r"\bapk apbn\b": "Pengelolaan Keuangan APBN",
    r"\bpbt\b": "Pengawas Benih Tanaman",
    r"\bpopt\b": "Pengendali Organisme Pengganggu Tumbuhan",
    r"\bppupd\b": "Pengawas Penyelenggaraan Urusan Pemerintahan Daerah",
    r"\bpsm\b": "Penggerak Swadaya Masyarakat",
    r"\bwi\b": "Widyaiswara",
    r"\bkementerian panrb\b": "Kementerian Pendayagunaan Aparatur Negara dan Reformasi Birokrasi",
    r"\bkemenpanrb\b": "Kementerian Pendayagunaan Aparatur Negara dan Reformasi Birokrasi",
    r"\bkemenpan-rb\b": "Kementerian Pendayagunaan Aparatur Negara dan Reformasi Birokrasi",
    r"\bkementerian pu\b": "Kementerian Pekerjaan Umum",
    r"\bkementrian pu\b": "Kementerian Pekerjaan Umum",
    r"\bbkkbn\b": "Kementerian Kependudukan Dan Pembangunan Keluarga/Badan Kependudukan Dan Keluarga Berencana Nasional",
    r"\bbkpm\b": "Kementerian Investasi dan Hilirisasi/Badan Koordinasi Penanaman Modal",
    r"\bkementerian imipas\b": "Kementerian Imigrasi dan Pemasyarakatan",
    r"\bpemda diy\b": "Pemerintah Daerah Daerah Istimewa Yogyakarta",
    r"\bpemerintah daerah diy\b": "Pemerintah Daerah Daerah Istimewa Yogyakarta",
    r"\bbpk ri\b": "Badan Pemeriksa Keuangan",
    r"\bbpk\b": "Badan Pemeriksa Keuangan",
    r"\bkemnaker ri\b": "Kementerian Ketenagakerjaan",
    r"\bkemnaker\b": "Kementerian Ketenagakerjaan",
    r"\bkemenkeu\b": "Kementerian Keuangan",
    r"\bkemenag\b": "Kementerian Agama",
    r"\bkemenkes\b": "Kementerian Kesehatan",
    r"\blan ri\b": "Lembaga Administrasi Negara",
    r"\bbkn ri\b": "Badan Kepegawaian Negara",
    r"\bombudsman ri\b": "Ombudsman Republik Indonesia",
    r"\blpp rri\b": "Lembaga Penyiaran Publik Radio Republik Indonesia",
    r"\brri\b": "Lembaga Penyiaran Publik Radio Republik Indonesia",
    r"\blpp tvri\b": "Lembaga Penyiaran Publik Televisi Republik Indonesia",
    r"\btvri\b": "Lembaga Penyiaran Publik Televisi Republik Indonesia",
    r"\bbpjn ntt\b": "Kementerian Pekerjaan Umum",
    r"\b(?:bbpjn|bpjn)\b.*": "Kementerian Pekerjaan Umum",
    r"\bbalai (?:besar )?pelaksanaan jalan nasional\b.*": "Kementerian Pekerjaan Umum",
    r"\b(?:bbws|balai (?:besar )?wilayah sungai)\b.*": "Kementerian Pekerjaan Umum",
    r"\bkemenpu\b": "Kementerian Pekerjaan Umum",
    r"\bbalai diklat keagamaan\b.*": "Kementerian Agama",
    r"\bbalai karantina\b.*": "Badan Karantina Indonesia",
    r"\bkotamadya\b": "Kota",
    r"\bkec\b": "Kecamatan",
    r"\bpemerintah provinsi dki jakarta\b": "Pemerintah Provinsi Daerah Khusus Ibukota Jakarta",
    r"\bpemprov dki jakarta\b": "Pemerintah Provinsi Daerah Khusus Ibukota Jakarta",
    r"\bpemprov dki\b": "Pemerintah Provinsi Daerah Khusus Ibukota Jakarta",
    r"\bprovinsi dki jakarta\b": "Pemerintah Provinsi Daerah Khusus Ibukota Jakarta",
    r"\bdki jakarta\b": "Pemerintah Provinsi Daerah Khusus Ibukota Jakarta",
    r"\bpemerintah kab\. siak\b": "Pemerintah Kab. Siak",
    r"\bpemkab belitung timur\b": "Pemerintah Kab. Belitung Timur",
    r"\bprovinsi kepulauan riau\b": "Pemerintah Provinsi Kepulauan Riau",
    r"\bpemerintah provinsi daerah istimewa yogyakarta\b": "Pemerintah Daerah Daerah Istimewa Yogyakarta",
}

SINGKATAN_PROVINSI = {
    "Kepri": "Kepulauan Riau",
    "Jatim": "Jawa Timur",
    "Jateng": "Jawa Tengah",
    "Jabar": "Jawa Barat",
    "Sumut": "Sumatera Utara",
    "Sumbar": "Sumatera Barat",
    "Sumsel": "Sumatera Selatan",
    "Kaltim": "Kalimantan Timur",
    "Kalsel": "Kalimantan Selatan",
    "Kalbar": "Kalimantan Barat",
    "Kalteng": "Kalimantan Tengah",
    "Kaltara": "Kalimantan Utara",
    "Sulsel": "Sulawesi Selatan",
    "Sulut": "Sulawesi Utara",
    "Sulteng": "Sulawesi Tengah",
    "Sultra": "Sulawesi Tenggara",
    "Sulbar": "Sulawesi Barat",
    "Babel": "Kepulauan Bangka Belitung",
    "Ntt": "Nusa Tenggara Timur",
    "Ntb": "Nusa Tenggara Barat",
    "Diy": "Daerah Istimewa Yogyakarta",
}

PREFIX_BUKAN_PEMDA = re.compile(
    r"^(?:kementerian|kementrian|kemen\w*|kantor wilayah|kanwil|kantor imigrasi|kantor pelayanan|"
    r"universitas|politeknik|institut|sekolah tinggi|stikes|stkip|stie|uin|iain|"
    r"badan pusat statistik|bps|kejaksaan|pengadilan|polda|polres|kodam|badan pertanahan|"
    r"bpn|bpjs|bank|pt|cv|yayasan|lembaga)\b",
    re.IGNORECASE,
)

SPLIT_UNIT_KERJA = (
    r"\b(?:bidang|bagian|subbag|sub bagian|seksi|uptd|upt|cabang|unit|kantor|sekretariat|"
    r"dinas|badan|puskesmas|rsud|smk|sma|smp|sd|kecamatan|kelurahan|desa|bappeda|bkpsdm)\b"
)

KATA_BIASA_AWALAN_KEDINASAN = {
    "DISABILITAS", "DISIPLIN", "DISTRIBUSI", "DISEMINASI", "DISETARAKAN", "DISASTER",
    "DISTEM", "DISINGKAT", "DISPOSISI", "DISPENSASI", "DISKUSI", "DISPARITAS",
    "DISTRIK", "DISERTAI", "DISEBUT", "DISAMPAIKAN", "DISKRESI", "DISINFEKSI",
    "BAPAK", "BAPTIS",
}
KATA_BIASA_PENDEK = {"AIR", "API", "ADA", "TUA", "KAS", "SAR", "UJI"}
AKRONIM_PASTI = {
    "SETDA", "PEMDA", "PEMKO", "PEMKAB", "POLDA", "POLRES", "POLRI", "KEPRI",
    "STIE", "STIS", "STAN", "BPJS", "BAPPENAS", "SEKDA",
}
KATA_UMUM_HURUF_BESAR = {
    "DAN", "ATAU", "DI", "KE", "DARI", "PADA", "UNTUK", "YANG", "OLEH",
    "KOTA", "KAB", "DESA", "BAG", "SUB", "TATA", "USAHA", "UMUM", "AHLI", "MUDA",
    "KASI", "SEKSI", "BIDANG", "DINAS", "BADAN", "PUSAT", "BALAI", "UNIT", "UTAMA",
    "PERTAMA", "MADYA", "PRATAMA", "PENYELENGGARA", "PELAKSANA", "OPERASIONAL", "TEKNIS",
    "KEBIJAKAN", "WILAYAH", "PROVINSI", "KECAMATAN", "KELURAHAN",
}


def normalize_spacing(val: Any) -> str:
    return re.sub(r"\s+", " ", str(val)).strip()


def normalize_wilayah(text: str) -> str:
    text = re.sub(r"\b(?:kabupaten|kab)\b\.?\s*(?=\S)", "Kabupaten ", text, flags=re.IGNORECASE)
    text = re.sub(r"\b(?:provinsi|provininsi|propinsi|prov)\b\.?\s*(?=\S)", "Provinsi ", text, flags=re.IGNORECASE)
    return text


def expand_abbreviations(text: str) -> str:
    if not isinstance(text, str) or not text.strip():
        return ""
    cleaned = normalize_wilayah(normalize_spacing(text))
    for pattern, replacement in ABBREVIATION_MAP.items():
        cleaned = re.sub(pattern, replacement, cleaned, flags=re.IGNORECASE)
    return normalize_spacing(cleaned)


def _potong_nama_wilayah(raw_name: str) -> str:
    name = re.split(SPLIT_UNIT_KERJA, raw_name, flags=re.IGNORECASE)[0]
    name = re.sub(r"\s+", " ", name).strip().title()
    return SINGKATAN_PROVINSI.get(name, name)


def map_dinas_to_pemda(text: str) -> str:
    if not isinstance(text, str) or not text.strip():
        return ""
    if PREFIX_BUKAN_PEMDA.match(text.strip()):
        return text

    m = re.search(r"\b(?:provinsi|pemprov)\b\.?\s+([a-zA-Z\s]+)", text, re.IGNORECASE)
    if m:
        nama = _potong_nama_wilayah(m.group(1))
        if nama:
            if "Dki" in nama:
                return "Pemerintah Provinsi Daerah Khusus Ibukota Jakarta"
            return f"Pemerintah Provinsi {nama}"

    m = re.search(r"\b(?:kabupaten|pemkab|pemkan)\b\.?\s+([a-zA-Z\s]+)", text, re.IGNORECASE)
    if m:
        nama = _potong_nama_wilayah(m.group(1))
        if nama:
            return f"Pemerintah Kab. {nama}"

    m = re.search(r"\b(?:kota|pemkot|pemko|kotamadya)\b\.?\s+([a-zA-Z\s]+)", text, re.IGNORECASE)
    if m:
        nama = _potong_nama_wilayah(m.group(1))
        if nama:
            return f"Pemerintah Kota {nama}"

    return text


def _vowel_ratio(token_upper: str) -> float:
    letters = [c for c in token_upper if c.isalpha()]
    if not letters:
        return 0.0
    return sum(c in "AEIOU" for c in letters) / len(letters)


def is_dynamic_acronym(token_upper: str, raw_token: str) -> bool:
    if token_upper in KATA_UMUM_HURUF_BESAR:
        return False
    if token_upper in AKRONIM_PASTI:
        return True
    if token_upper in KATA_BIASA_AWALAN_KEDINASAN or token_upper in KATA_BIASA_PENDEK:
        return False

    raw_upper = raw_token.isupper()
    if raw_upper and 2 <= len(token_upper) <= 3:
        return True
    if raw_upper and 4 <= len(token_upper) <= 7 and _vowel_ratio(token_upper) <= 0.30:
        return True
    if raw_upper and 4 <= len(token_upper) <= 12:
        if token_upper.startswith(("DIS", "BAP", "BK", "BP", "RS", "UPT")):
            return True
    if token_upper in {"II", "III", "IV", "VI", "VII", "VIII", "IX", "XI", "XII"}:
        return True
    return False


def to_title_case(val: str) -> str:
    cleaned = normalize_spacing(val)
    if not cleaned:
        return ""
    kata_hubung = {"dan", "atau", "di", "ke", "dari", "pada", "untuk", "yang", "oleh"}

    def format_token(token: str) -> str:
        pfx_m = re.match(r"^([(\[\"']+)", token)
        sfx_m = re.search(r"([)\]\"',.:;]+)$", token)
        pfx = pfx_m.group(1) if pfx_m else ""
        sfx = sfx_m.group(1) if sfx_m else ""
        core = token[len(pfx):len(token) - len(sfx)] if sfx else token[len(pfx):]
        if not core:
            return token
        core_upper = core.upper()
        if is_dynamic_acronym(core_upper, core):
            res = core_upper
        elif "-" in core:
            sub_parts = core.split("-")
            res = "-".join(p.upper() if is_dynamic_acronym(p.upper(), p) else p.capitalize() for p in sub_parts)
        else:
            res = core.capitalize()
        return f"{pfx}{res}{sfx}"

    words = cleaned.split(" ")
    formatted_words: List[str] = []
    for i, w in enumerate(words):
        w_lower = w.lower()
        if i > 0 and w_lower in kata_hubung:
            formatted_words.append(w_lower)
        elif "/" in w:
            slash_parts = w.split("/")
            formatted_words.append("/".join(format_token(p) for p in slash_parts))
        else:
            formatted_words.append(format_token(w))
    return " ".join(formatted_words)


def _find_ref_file(preferred_name: str, fallback_glob: str) -> Optional[Path]:
    candidate = REFERENCES_DIR / preferred_name
    if candidate.exists():
        return candidate
    matches = sorted(REFERENCES_DIR.glob(fallback_glob))
    return matches[0] if matches else None


def load_master_references() -> Tuple[List[str], List[str]]:
    instansi_path = _find_ref_file("master_instansi_bkn_202609221425.csv", "*instansi*.csv")
    jf_path = _find_ref_file("master_jf_202609221427.csv", "*jf*.csv")

    instansi_ref: List[str] = []
    if instansi_path and "override" not in instansi_path.name.lower():
        cols, rows = read_csv_dicts(str(instansi_path))
        if "nama" in cols:
            seen = set()
            for r in rows:
                v = r.get("nama")
                if v:
                    tc = to_title_case(v)
                    if tc and tc not in seen:
                        seen.add(tc)
                        instansi_ref.append(tc)

    jf_ref: List[str] = []
    if jf_path and "override" not in jf_path.name.lower():
        cols, rows = read_csv_dicts(str(jf_path))
        if "nama" in cols:
            seen = set()
            for r in rows:
                v = r.get("nama")
                if v:
                    tc = to_title_case(v)
                    if tc and tc not in seen:
                        seen.add(tc)
                        jf_ref.append(tc)

    return instansi_ref, jf_ref


def load_manual_overrides(path: Optional[Path]) -> Dict[str, str]:
    if not path or not path.exists():
        return {}
    cols, rows = read_csv_dicts(str(path))
    if not rows:
        return {}
    if not {"dari", "ke"}.issubset(set(cols)):
        raise ValueError(f"{path.name} harus punya kolom 'dari' dan 'ke'")
    out: Dict[str, str] = {}
    for r in rows:
        dari = r.get("dari")
        ke = r.get("ke")
        if dari and ke and str(ke).strip():
            out[normalize_spacing(dari).lower()] = normalize_spacing(ke)
    return out


def build_three_stage_jabatan_mapping(
    unique_values: List[str],
    jf_choices: List[str],
    pelaksana_choices: List[str],
    threshold: int,
) -> Dict[str, Optional[str]]:
    mapping: Dict[str, Optional[str]] = {}
    invalid_tokens = {"-", "", "nan", "none", "<na>", "nat"}

    jf_dict = {normalize_spacing(c).lower(): c for c in jf_choices if c}
    jf_keys = list(jf_dict.keys())
    pelaksana_dict = {normalize_spacing(c).lower(): c for c in pelaksana_choices if c}
    pelaksana_keys = list(pelaksana_dict.keys())

    for val in unique_values:
        if not val or str(val).strip().lower() in invalid_tokens:
            mapping[val] = None
            continue
        preprocessed = expand_abbreviations(val)
        norm_val = normalize_spacing(preprocessed).lower()

        if norm_val in jf_dict:
            mapping[val] = jf_dict[norm_val]
            continue

        match_jf = fuzzy_extract_one(norm_val, jf_keys)
        if match_jf and match_jf[1] >= threshold:
            mapping[val] = jf_dict[match_jf[0]]
            continue

        if norm_val in pelaksana_dict:
            mapping[val] = pelaksana_dict[norm_val]
            continue

        match_pelaksana = fuzzy_extract_one(norm_val, pelaksana_keys)
        if match_pelaksana and match_pelaksana[1] >= threshold:
            mapping[val] = pelaksana_dict[match_pelaksana[0]]
            continue

        mapping[val] = to_title_case(preprocessed)
    return mapping


def build_instansi_mapping(unique_values: List[str], choices: List[str], threshold: int) -> Dict[str, Optional[str]]:
    mapping: Dict[str, Optional[str]] = {}
    invalid_tokens = {"-", "", "nan", "none", "<na>", "nat"}

    choice_dict = {normalize_spacing(c).lower(): c for c in choices if c}
    choice_keys = list(choice_dict.keys())

    for val in unique_values:
        if not val or str(val).strip().lower() in invalid_tokens:
            mapping[val] = None
            continue
        preprocessed = expand_abbreviations(val)
        preprocessed = map_dinas_to_pemda(preprocessed)
        normalized_val = normalize_spacing(preprocessed).lower()

        if normalized_val in choice_dict:
            mapping[val] = choice_dict[normalized_val]
            continue

        match = fuzzy_extract_one(normalized_val, choice_keys)
        if match and match[1] >= threshold:
            mapping[val] = choice_dict[match[0]]
        else:
            mapping[val] = to_title_case(preprocessed)
    return mapping


def _clean_trailing_val(val: Any) -> Optional[str]:
    if is_missing(val):
        return None
    s = str(val).strip()
    if not s or s.lower() in {"nan", "none", "<na>", "nat"}:
        return None
    s = re.sub(r"[|*]\s*$", "", s).strip()
    return s if s else None


def _parse_webinar_ref_2025() -> Dict[str, Dict[str, Optional[str]]]:
    ref_path = REFERENCES_DIR / "ref_webinar_2025.csv"
    if not ref_path.exists():
        return {}
    _, rows = read_csv_dicts(str(ref_path))
    out: Dict[str, Dict[str, Optional[str]]] = {}
    for r in rows:
        key = r.get("series_name")
        if key:
            out[str(key).strip()] = {
                "tanggal_webinar": r.get("tanggal_webinar"),
                "judul_webinar": r.get("judul_webinar"),
            }
    return out


def _extract_2025_rows(
    sheet_name: str,
    rows: List[Dict[str, Any]],
    ref_2025: Dict[str, Dict[str, Optional[str]]],
) -> Tuple[List[Dict[str, Any]], str]:
    extracted: List[Dict[str, Any]] = []
    for r in rows:
        series_val = None if is_missing(r.get("Series VPL yang diikuti")) else str(r.get("Series VPL yang diikuti")).strip()
        ref_meta = ref_2025.get(series_val or "", {})
        extracted.append({
            "id": None,
            "series_vpl": series_val,
            "nama_peserta": None,
            "email": None,
            "jenis_kelamin": _clean_trailing_val(r.get("Jenis Kelamin")),
            "jabatan_raw": _clean_trailing_val(r.get("Jabatan")),
            "instansi_raw": _clean_trailing_val(r.get("Nama Instansi/Organisasi")),
            "jenis_instansi": _clean_trailing_val(r.get("Jenis Instansi/Organisasi")),
            "asal_daerah": _clean_trailing_val(r.get("Asal Daerah Instansi")),
            "tanggal_webinar": ref_meta.get("tanggal_webinar"),
            "judul_webinar": _clean_trailing_val(ref_meta.get("judul_webinar")),
            "tahun_kegiatan": 2025,
        })
    return extracted, f"{sheet_name} (2025: {len(rows)} baris)"


def _extract_2026_rows(
    sheet_name: str,
    rows: List[Dict[str, Any]],
) -> Tuple[List[Dict[str, Any]], str]:
    extracted: List[Dict[str, Any]] = []
    for r in rows:
        email = r.get("Email Address")
        if is_missing(email) or str(email).strip() == "":
            email = r.get("Email")
        extracted.append({
            "id": None,
            "series_vpl": None if is_missing(r.get("VPL Series yang diikuti")) else str(r.get("VPL Series yang diikuti")).strip(),
            "nama_peserta": _clean_trailing_val(r.get("Nama lengkap beserta gelar")),
            "email": _clean_trailing_val(email),
            "jenis_kelamin": _clean_trailing_val(r.get("Jenis Kelamin")),
            "jabatan_raw": _clean_trailing_val(r.get("Jabatan")),
            "instansi_raw": _clean_trailing_val(r.get("Nama Instansi")),
            "jenis_instansi": _clean_trailing_val(r.get("Jenis Instansi/Organisasi")),
            "asal_daerah": _clean_trailing_val(r.get("Asal Daerah Provinsi")),
            "tanggal_webinar": None,
            "judul_webinar": None,
            "tahun_kegiatan": 2026,
        })
    return extracted, f"{sheet_name} (2026: {len(rows)} baris)"


def extract_transform_2025(excel_path: str) -> Tuple[List[Dict[str, Any]], List[str]]:
    sheets = read_excel_sheets(excel_path, sheet_names=None, header=0)
    ref_2025 = _parse_webinar_ref_2025()
    records: List[Dict[str, Any]] = []
    sheet_notes: List[str] = []

    for sheet_name, sheet_data in sheets.items():
        cols = sheet_data.get("columns", [])
        rows = sheet_data.get("rows", [])
        if "Series VPL yang diikuti" in set(cols):
            part_rows, note = _extract_2025_rows(sheet_name, rows, ref_2025)
            records.extend(part_rows)
            sheet_notes.append(note)

    if not sheet_notes:
        raise ValueError(
            "File Excel VPL 2025 tidak memiliki kolom standar 'Series VPL yang diikuti'."
        )
    return records, sheet_notes


def extract_transform_2026(excel_path: str) -> Tuple[List[Dict[str, Any]], List[str]]:
    sheets = read_excel_sheets(excel_path, sheet_names=None, header=0)
    records: List[Dict[str, Any]] = []
    sheet_notes: List[str] = []

    for sheet_name, sheet_data in sheets.items():
        cols = sheet_data.get("columns", [])
        rows = sheet_data.get("rows", [])
        if "VPL Series yang diikuti" in set(cols):
            part_rows, note = _extract_2026_rows(sheet_name, rows)
            records.extend(part_rows)
            sheet_notes.append(note)

    if not sheet_notes:
        raise ValueError(
            "File Excel VPL 2026 tidak memiliki kolom standar 'VPL Series yang diikuti'."
        )
    return records, sheet_notes


def _extract_workbook_records(excel_path: str) -> Tuple[List[Dict[str, Any]], List[str]]:
    sheets = read_excel_sheets(excel_path, sheet_names=None, header=0)
    ref_2025 = _parse_webinar_ref_2025()
    records_2025: List[Dict[str, Any]] = []
    notes_2025: List[str] = []
    records_2026: List[Dict[str, Any]] = []
    notes_2026: List[str] = []

    for sheet_name, sheet_data in sheets.items():
        cols = sheet_data.get("columns", [])
        rows = sheet_data.get("rows", [])
        col_set = set(cols)

        if "Series VPL yang diikuti" in col_set:
            part_rows, note = _extract_2025_rows(sheet_name, rows, ref_2025)
            records_2025.extend(part_rows)
            notes_2025.append(note)
        elif "VPL Series yang diikuti" in col_set:
            part_rows, note = _extract_2026_rows(sheet_name, rows)
            records_2026.extend(part_rows)
            notes_2026.append(note)

    sheet_notes = notes_2025 + notes_2026
    if not sheet_notes:
        raise ValueError(
            "Kolom standar VPL ('VPL Series yang diikuti' atau 'Series VPL yang diikuti') tidak ditemukan pada sheet Excel."
        )
    return records_2025 + records_2026, sheet_notes


def _parse_date_val(val: Any) -> Optional[dt.date]:
    if is_missing(val):
        return None
    if isinstance(val, dt.datetime):
        return val.date()
    if isinstance(val, dt.date):
        return val
    s = str(val).strip()
    if not s:
        return None
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y"):
        try:
            return dt.datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    return None


def _ensure_table(client: ClickHouseClientWrapper) -> None:
    client.command("CREATE DATABASE IF NOT EXISTS db_vpl")
    existing_cols = client.query_rows(
        "SELECT type FROM system.columns "
        "WHERE database = 'db_vpl' AND table = 'vpl_series_atax' AND name = 'id' LIMIT 1"
    )
    if existing_cols and existing_cols[0] and str(existing_cols[0][0]).strip() != "UInt32":
        client.command(f"DROP TABLE IF EXISTS {TABLE_NAME}")
    client.command(
        f"""
        CREATE TABLE IF NOT EXISTS {TABLE_NAME} (
            id UInt32,
            series_vpl Nullable(String),
            nama_peserta Nullable(String),
            email Nullable(String),
            jenis_kelamin Nullable(String),
            jabatan_raw Nullable(String),
            instansi_raw Nullable(String),
            jenis_instansi Nullable(String),
            asal_daerah Nullable(String),
            jabatan_clean Nullable(String),
            instansi_clean Nullable(String),
            tanggal_webinar Nullable(Date),
            judul_webinar Nullable(String),
            tahun_kegiatan UInt16
        ) ENGINE = MergeTree
        ORDER BY id
        """
    )


def run(
    action: str = "preview",
    input_path: Optional[str] = None,
    input_2025: Optional[str] = None,
    input_2026: Optional[str] = None,
    target_db: Optional[str] = None,
    target_table: Optional[str] = None,
    engine: Optional[str] = None,
    order_by: Optional[str] = None,
    **_: Any,
) -> Dict[str, Any]:
    path_2025 = (input_2025 or "").strip() or None
    path_2026 = (input_2026 or "").strip() or None
    path_legacy = (input_path or "").strip() or None

    if path_2025 and not os.path.exists(path_2025):
        raise ValueError("File Excel VPL 2025 tidak ditemukan di server.")
    if path_2026 and not os.path.exists(path_2026):
        raise ValueError("File Excel VPL 2026 tidak ditemukan di server.")
    if not path_2025 and not path_2026:
        if not path_legacy or not os.path.exists(path_legacy):
            raise ValueError("Minimal satu file Excel (.xlsx) Peserta VPL 2025 atau 2026 wajib diunggah.")

    custom_target = validate_custom_target_params(target_db, target_table, engine, order_by, OUTPUT_SCHEMA)
    effective_target = f"{custom_target[0]}.{custom_target[1]}" if custom_target else TABLE_NAME

    instansi_ref, jf_ref = load_master_references()
    ov_inst = load_manual_overrides(REFERENCES_DIR / "manual_override_instansi.csv")
    ov_jab = load_manual_overrides(REFERENCES_DIR / "manual_override_jabatan.csv")

    if path_2025 or path_2026:
        records_2025: List[Dict[str, Any]] = []
        notes_2025: List[str] = []
        records_2026: List[Dict[str, Any]] = []
        notes_2026: List[str] = []
        if path_2025:
            records_2025, notes_2025 = extract_transform_2025(path_2025)
        if path_2026:
            records_2026, notes_2026 = extract_transform_2026(path_2026)
        records = records_2025 + records_2026
        sheet_notes = notes_2025 + notes_2026
    else:
        assert path_legacy is not None
        records, sheet_notes = _extract_workbook_records(path_legacy)

    for idx, rec in enumerate(records, start=1):
        rec["id"] = int(idx)

    unique_jabatan = sorted({str(r["jabatan_raw"]) for r in records if r.get("jabatan_raw")})
    unique_instansi = sorted({str(r["instansi_raw"]) for r in records if r.get("instansi_raw")})

    jf_mapping = build_three_stage_jabatan_mapping(
        unique_values=unique_jabatan,
        jf_choices=jf_ref,
        pelaksana_choices=MASTER_JABATAN_PELAKSANA,
        threshold=FUZZY_THRESHOLD,
    )
    instansi_mapping = build_instansi_mapping(
        unique_values=unique_instansi,
        choices=instansi_ref,
        threshold=FUZZY_THRESHOLD,
    )

    n_inst_ov = 0
    n_jab_ov = 0
    for rec in records:
        jab_raw = rec.get("jabatan_raw")
        inst_raw = rec.get("instansi_raw")
        jab_clean = jf_mapping.get(str(jab_raw)) if jab_raw else None
        inst_clean = instansi_mapping.get(str(inst_raw)) if inst_raw else None

        if inst_clean and ov_inst:
            key = normalize_spacing(inst_clean).lower()
            if key in ov_inst:
                inst_clean = ov_inst[key]
                n_inst_ov += 1

        if jab_clean and ov_jab:
            key = normalize_spacing(jab_clean).lower()
            if key in ov_jab:
                jab_clean = ov_jab[key]
                n_jab_ov += 1

        rec["jabatan_clean"] = jab_clean
        rec["instansi_clean"] = inst_clean
        rec["tanggal_webinar"] = _parse_date_val(rec.get("tanggal_webinar"))

    tahun_counts: Dict[str, int] = {}
    for rec in records:
        yr = str(rec["tahun_kegiatan"])
        tahun_counts[yr] = tahun_counts.get(yr, 0) + 1

    if action == "sync_db":
        payload: List[List[Any]] = []
        for rec in records:
            entry: List[Any] = []
            for col in COLS_SCHEMA:
                val = rec.get(col)
                if val is None or str(val).strip().lower() in {"nan", "none", "<na>", "nat", ""}:
                    entry.append(None)
                elif col in STR_COLS:
                    entry.append(str(val).strip())
                elif col == "tanggal_webinar":
                    entry.append(val if isinstance(val, dt.date) else _parse_date_val(val))
                elif col in ("tahun_kegiatan", "id"):
                    entry.append(int(val))
                else:
                    entry.append(val)
            payload.append(entry)

        client = ClickHouseClientWrapper(get_clickhouse_config())
        if custom_target is not None:
            effective_target = sync_to_custom_table(
                client=client,
                target_db=custom_target[0],
                target_table=custom_target[1],
                engine=custom_target[2],
                order_by=custom_target[3],
                column_schema=OUTPUT_SCHEMA,
                rows_payload=payload,
            )
            msg = f"Berhasil membuat tabel baru {effective_target} ({custom_target[2]}) dan memasukkan {len(payload)} baris hasil ETL."
        else:
            _ensure_table(client)
            client.command(f"TRUNCATE TABLE {TABLE_NAME}")
            client.insert(TABLE_NAME, payload, column_names=COLS_SCHEMA)
            msg = f"Berhasil menjalankan TRUNCATE + INSERT {len(payload)} baris peserta VPL ke {TABLE_NAME}."
    else:
        msg = f"Berhasil menstandarisasi {len(records)} baris peserta VPL ({', '.join(sheet_notes)})."

    serialized = serialize_rows_for_json(COLS_SCHEMA, records)
    stamp = dt.datetime.now().strftime("%Y%m%d%H%M")
    csv_path, csv_filename = write_csv_to_tmp(f"peserta_vpl_{stamp}.csv", COLS_SCHEMA, serialized)

    return {
        "status": "ok",
        "pipeline": "peserta_vpl",
        "action": action,
        "targetTable": effective_target,
        "columns": COLS_SCHEMA,
        "column_schema": OUTPUT_SCHEMA,
        "rows": serialized,
        "total_rows": len(serialized),
        "csv_path": csv_path,
        "csv_filename": csv_filename,
        "summary": {
            "total_rows": len(serialized),
            "rows_2025": tahun_counts.get("2025", 0),
            "rows_2026": tahun_counts.get("2026", 0),
            "sheets": sheet_notes,
            "tahun_counts": tahun_counts,
            "master_instansi_count": len(instansi_ref),
            "master_jf_count": len(jf_ref),
            "overrides_instansi_hit": n_inst_ov,
            "overrides_jabatan_hit": n_jab_ov,
        },
        "message": msg,
    }
