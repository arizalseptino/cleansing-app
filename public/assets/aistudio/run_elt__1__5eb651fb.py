import logging
import os
import re
from datetime import datetime
from typing import Dict, List, Optional, Set, Tuple

import pandas as pd
from clickhouse_connect import get_client
from clickhouse_connect.driver import options
from rapidfuzz import fuzz, process

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S"
)
logger = logging.getLogger("VPL_ELT_Pipeline")

options.pd = None

CONFIG = {
    "clickhouse": {
        "host": "localhost",
        "port": 8123,
        "username": "default",
        "password": "",
        "database": "db_vpl",
        "table": "vpl_series_atax"
    },
    "paths": {
        "instansi_master": "master_instansi_bkn_202609221425.csv",
        "jf_master": "master_jf_202609221427.csv",
        "data_2025": "Data Peserta VPL Series ATA-X Ditekdijar.xlsx",
        "ref_2025": "ref_webinar_2025.csv",
        "data_2026": "Data VPL 2026 Seri 1 dan 2.xlsx",
        "override_instansi": "manual_override_instansi.csv",
        "override_jabatan": "manual_override_jabatan.csv"
    },
    "fuzzy_threshold": 85
}

COLS_SCHEMA = [
    "id", "series_vpl", "nama_peserta", "email", "jenis_kelamin",
    "jabatan_raw", "instansi_raw", "jenis_instansi", "asal_daerah",
    "jabatan_clean", "instansi_clean", "tanggal_webinar", "judul_webinar",
    "tahun_kegiatan"
]

STR_COLS = {
    "series_vpl", "nama_peserta", "email", "jenis_kelamin",
    "jabatan_raw", "instansi_raw", "jenis_instansi", "asal_daerah",
    "jabatan_clean", "instansi_clean", "judul_webinar"
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
    "Pelaksana"
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
    r"\bpemerintah provinsi daerah istimewa yogyakarta\b": "Pemerintah Daerah Daerah Istimewa Yogyakarta"
}

def normalize_spacing(val: str) -> str:
    return re.sub(r"\s+", " ", str(val)).strip()

def normalize_wilayah(text: str) -> str:
    text = re.sub(r"\b(?:kabupaten|kab)\b\.?\s*(?=\S)", "Kabupaten ", text, flags=re.IGNORECASE)
    text = re.sub(r"\b(?:provinsi|provininsi|propinsi|prov)\b\.?\s*(?=\S)", "Provinsi ", text, flags=re.IGNORECASE)
    return text

SINGKATAN_PROVINSI = {
    "Kepri": "Kepulauan Riau", "Jatim": "Jawa Timur", "Jateng": "Jawa Tengah", "Jabar": "Jawa Barat",
    "Sumut": "Sumatera Utara", "Sumbar": "Sumatera Barat", "Sumsel": "Sumatera Selatan",
    "Kaltim": "Kalimantan Timur", "Kalsel": "Kalimantan Selatan", "Kalbar": "Kalimantan Barat",
    "Kalteng": "Kalimantan Tengah", "Kaltara": "Kalimantan Utara", "Sulsel": "Sulawesi Selatan",
    "Sulut": "Sulawesi Utara", "Sulteng": "Sulawesi Tengah", "Sultra": "Sulawesi Tenggara",
    "Sulbar": "Sulawesi Barat", "Babel": "Kepulauan Bangka Belitung", "Ntt": "Nusa Tenggara Timur",
    "Ntb": "Nusa Tenggara Barat", "Diy": "Daerah Istimewa Yogyakarta",
}

def expand_abbreviations(text: str) -> str:
    if not isinstance(text, str) or not text.strip():
        return ""
    cleaned = normalize_wilayah(normalize_spacing(text))
    for pattern, replacement in ABBREVIATION_MAP.items():
        cleaned = re.sub(pattern, replacement, cleaned, flags=re.IGNORECASE)
    return normalize_spacing(cleaned)

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

KATA_BIASA_AWALAN_KEDINASAN = {
    # kata Indonesia biasa yang kebetulan berawalan DIS/BAP/BK/BP/RS/UPT
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
    "KEBIJAKAN", "WILAYAH", "PROVINSI", "KECAMATAN", "KELURAHAN"
}

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
        core = token[len(pfx):len(token)-len(sfx)] if sfx else token[len(pfx):]
        
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
    formatted_words = []

    for i, w in enumerate(words):
        w_lower = w.lower()
        if i > 0 and w_lower in kata_hubung:
            formatted_words.append(w_lower)
        elif "/" in w:
            slash_parts = w.split("/")
            formatted_slash = [format_token(p) for p in slash_parts]
            formatted_words.append("/".join(formatted_slash))
        else:
            formatted_words.append(format_token(w))

    return " ".join(formatted_words)

def load_master_references(path_instansi: str, path_jf: str) -> Tuple[List[str], List[str]]:
    df_instansi = pd.read_csv(path_instansi, usecols=["nama"])
    df_jf = pd.read_csv(path_jf, usecols=["nama"])
    
    instansi_ref = df_instansi["nama"].dropna().map(to_title_case).unique().tolist()
    jf_ref = df_jf["nama"].dropna().map(to_title_case).unique().tolist()
    
    return instansi_ref, jf_ref

def build_three_stage_jabatan_mapping(
    unique_values: List[str], 
    jf_choices: List[str], 
    pelaksana_choices: List[str], 
    threshold: int
) -> Dict[str, Optional[str]]:
    mapping = {}
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

        # Tahap 1: Cek Master JF BKN
        if norm_val in jf_dict:
            mapping[val] = jf_dict[norm_val]
            continue

        match_jf = process.extractOne(norm_val, jf_keys, scorer=fuzz.token_sort_ratio)
        if match_jf and match_jf[1] >= threshold:
            mapping[val] = jf_dict[match_jf[0]]
            continue

        # Tahap 2: Cek Standar Jabatan Pelaksana (Baku)
        if norm_val in pelaksana_dict:
            mapping[val] = pelaksana_dict[norm_val]
            continue

        match_pelaksana = process.extractOne(norm_val, pelaksana_keys, scorer=fuzz.token_sort_ratio)
        if match_pelaksana and match_pelaksana[1] >= threshold:
            mapping[val] = pelaksana_dict[match_pelaksana[0]]
            continue

        # Tahap 3: Fallback Title Case Dinamis (Non-Master / Struktural)
        mapping[val] = to_title_case(preprocessed)

    return mapping

def build_instansi_mapping(unique_values: List[str], choices: List[str], threshold: int) -> Dict[str, Optional[str]]:
    mapping = {}
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

        # 1. Exact Match Master Instansi
        if normalized_val in choice_dict:
            mapping[val] = choice_dict[normalized_val]
            continue

        # 2. Fuzzy Match Master Instansi
        match = process.extractOne(normalized_val, choice_keys, scorer=fuzz.token_sort_ratio)
        if match and match[1] >= threshold:
            mapping[val] = choice_dict[match[0]]
        else:
            # 3. Fallback: Pertahankan format akronim dinamis atau Title Case
            mapping[val] = to_title_case(preprocessed)
            
    return mapping

def load_manual_overrides(path: str) -> Dict[str, str]:
    if not path or not os.path.exists(path):
        logger.info("Override manual tidak ditemukan (%s) - dilewati.", path)
        return {}
    df = pd.read_csv(path, dtype=str)
    if not {"dari", "ke"}.issubset(df.columns):
        raise ValueError(f"{path} harus punya kolom 'dari' dan 'ke'")
    out = {}
    for dari, ke in zip(df["dari"], df["ke"]):
        if pd.notna(dari) and pd.notna(ke) and str(ke).strip():
            out[normalize_spacing(dari).lower()] = normalize_spacing(ke)
    logger.info("Override manual dimuat dari %s: %d aturan.", path, len(out))
    return out

def apply_overrides(series: pd.Series, overrides: Dict[str, str]) -> Tuple[pd.Series, int]:
    if not overrides:
        return series, 0
    keys = series.map(lambda v: normalize_spacing(v).lower() if isinstance(v, str) else None)
    hit = keys.isin(overrides.keys())
    result = series.copy()
    result[hit] = keys[hit].map(overrides)
    return result, int(hit.sum())

def extract_transform_2025(data_path: str, ref_path: str) -> pd.DataFrame:
    df_raw = pd.read_excel(data_path)
    df_ref = pd.read_csv(ref_path)
    
    df_merged = df_raw.merge(
        df_ref, 
        left_on="Series VPL yang diikuti", 
        right_on="series_name", 
        how="left"
    )
    
    records_count = len(df_merged)
    return pd.DataFrame({
        "id": None,
        "series_vpl": df_merged["Series VPL yang diikuti"].astype(str),
        "nama_peserta": None,
        "email": None,
        "jenis_kelamin": df_merged["Jenis Kelamin"],
        "jabatan_raw": df_merged["Jabatan"],
        "instansi_raw": df_merged["Nama Instansi/Organisasi"],
        "jenis_instansi": df_merged["Jenis Instansi/Organisasi"],
        "asal_daerah": df_merged["Asal Daerah Instansi"],
        "tanggal_webinar": df_merged["tanggal_webinar"],
        "judul_webinar": df_merged["judul_webinar"],
        "tahun_kegiatan": 2025
    })

def extract_transform_2026(data_path: str) -> pd.DataFrame:
    sheets = pd.read_excel(data_path, sheet_name=None)
    df_raw = pd.concat(sheets.values(), ignore_index=True)
    
    if "Email Address" in df_raw.columns and "Email" in df_raw.columns:
        email_series = df_raw["Email Address"].fillna(df_raw["Email"])
    elif "Email Address" in df_raw.columns:
        email_series = df_raw["Email Address"]
    else:
        email_series = df_raw.get("Email")
        
    records_count = len(df_raw)
    return pd.DataFrame({
        "id": None,
        "series_vpl": df_raw["VPL Series yang diikuti"].astype(str),
        "nama_peserta": df_raw.get("Nama lengkap beserta gelar"),
        "email": email_series,
        "jenis_kelamin": df_raw.get("Jenis Kelamin"),
        "jabatan_raw": df_raw.get("Jabatan"),
        "instansi_raw": df_raw.get("Nama Instansi"),
        "jenis_instansi": df_raw.get("Jenis Instansi/Organisasi"),
        "asal_daerah": df_raw.get("Asal Daerah Provinsi"),
        "tanggal_webinar": None,
        "judul_webinar": None,
        "tahun_kegiatan": 2026
    })

def serialize_records(df: pd.DataFrame, columns: List[str], str_cols: Set[str]) -> List[list]:
    records = df[columns].to_dict("records")
    clean_rows = []
    
    for row in records:
        entry = []
        for col in columns:
            val = row[col]
            if val is None or pd.isna(val) or str(val).strip().lower() in {"nan", "none", "<na>", "nat"}:
                entry.append(None)
            elif col in str_cols:
                entry.append(str(val).strip())
            elif col == "tanggal_webinar":
                if isinstance(val, str):
                    try:
                        entry.append(datetime.strptime(val.strip(), "%Y-%m-%d").date())
                    except ValueError:
                        entry.append(None)
                elif hasattr(val, "date"):
                    entry.append(val.date())
                else:
                    entry.append(None)
            elif col in ("tahun_kegiatan", "id"):
                entry.append(int(val))
            else:
                entry.append(val)
        clean_rows.append(entry)
    return clean_rows

def main() -> None:
    logger.info("Initializing reference data ingestion...")
    instansi_ref, jf_ref = load_master_references(
        CONFIG["paths"]["instansi_master"], 
        CONFIG["paths"]["jf_master"]
    )
    logger.info("Loaded master references: %d instansi, %d JF BKN.", len(instansi_ref), len(jf_ref))

    logger.info("Ingesting and preparing 2025 and 2026 dataset...")
    df_2025 = extract_transform_2025(CONFIG["paths"]["data_2025"], CONFIG["paths"]["ref_2025"])
    df_2026 = extract_transform_2026(CONFIG["paths"]["data_2026"])
    
    df_consolidated = pd.concat([df_2025, df_2026], ignore_index=True)
    # id berurut 1..N
    df_consolidated["id"] = range(1, len(df_consolidated) + 1)
    logger.info("Total staging records loaded: %d", len(df_consolidated))

    logger.info("Executing 3-stage cascading normalization for jabatan & instansi...")
    unique_jabatan = df_consolidated["jabatan_raw"].dropna().astype(str).unique().tolist()
    unique_instansi = df_consolidated["instansi_raw"].dropna().astype(str).unique().tolist()

    # Normalisasi jabatan via 3-Stage Cascading Normalizer
    jf_mapping = build_three_stage_jabatan_mapping(
        unique_values=unique_jabatan,
        jf_choices=jf_ref,
        pelaksana_choices=MASTER_JABATAN_PELAKSANA,
        threshold=CONFIG["fuzzy_threshold"]
    )
    
    # Normalisasi instansi
    instansi_mapping = build_instansi_mapping(
        unique_values=unique_instansi,
        choices=instansi_ref,
        threshold=CONFIG["fuzzy_threshold"]
    )

    df_consolidated["jabatan_clean"] = df_consolidated["jabatan_raw"].astype(str).map(jf_mapping)
    df_consolidated["instansi_clean"] = df_consolidated["instansi_raw"].astype(str).map(instansi_mapping)

    logger.info("Menerapkan koreksi manual (jika ada)...")
    ov_inst = load_manual_overrides(CONFIG["paths"]["override_instansi"])
    ov_jab = load_manual_overrides(CONFIG["paths"]["override_jabatan"])
    df_consolidated["instansi_clean"], n_inst = apply_overrides(df_consolidated["instansi_clean"], ov_inst)
    df_consolidated["jabatan_clean"], n_jab = apply_overrides(df_consolidated["jabatan_clean"], ov_jab)
    logger.info("Baris terkoreksi manual: instansi=%d, jabatan=%d", n_inst, n_jab)

    logger.info("Serializing payloads for ClickHouse ingestion...")
    serialized_data = serialize_records(df_consolidated, COLS_SCHEMA, STR_COLS)

    logger.info("Connecting to ClickHouse and inserting records...")
    ch_conf = CONFIG["clickhouse"]
    client = get_client(
        host=ch_conf["host"],
        port=ch_conf["port"],
        username=ch_conf["username"],
        password=ch_conf["password"]
    )

    target_table = f"{ch_conf['database']}.{ch_conf['table']}"

    logger.info("Truncating target table before full-refresh insert...")
    client.command(f"TRUNCATE TABLE {target_table}")

    client.insert(target_table, serialized_data, column_names=COLS_SCHEMA)
    logger.info("Successfully synchronized %d rows into `%s`.", len(serialized_data), target_table)

if __name__ == "__main__":
    main()
