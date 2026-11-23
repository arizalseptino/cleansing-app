#!/usr/bin/env python3
import argparse
import json
import sys
from pathlib import Path
from typing import Any, Dict

# Ensure python-etl directory is on sys.path regardless of CWD
CURRENT_DIR = Path(__file__).resolve().parent
if str(CURRENT_DIR) not in sys.path:
    sys.path.insert(0, str(CURRENT_DIR))

from pipelines import anggaran_sp2d, course_es, media_humas, peserta_vpl

PIPELINES = {
    "media_humas": media_humas,
    "peserta_vpl": peserta_vpl,
    "anggaran_sp2d": anggaran_sp2d,
    "course_es": course_es,
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Python ETL Runner for cleansing-app")
    parser.add_argument("--pipeline", required=True, choices=sorted(PIPELINES.keys()))
    parser.add_argument("--action", default="preview", choices=["preview", "sync_db"])
    parser.add_argument("--input-path", default="")
    parser.add_argument("--raw-text", default="")
    parser.add_argument("--raw-text-file", default="")
    parser.add_argument("--start-date", default="")
    parser.add_argument("--end-date", default="")
    parser.add_argument("--tanggal-realisasi", default="")
    parser.add_argument("--target-db", default="")
    parser.add_argument("--target-table", default="")
    parser.add_argument("--engine", default="MergeTree")
    parser.add_argument("--order-by", default="")
    parser.add_argument("--json-params", default="")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    params: Dict[str, Any] = {
        "action": args.action,
        "input_path": args.input_path or None,
        "raw_text": args.raw_text or None,
        "start_date": args.start_date or None,
        "end_date": args.end_date or None,
        "tanggal_realisasi": args.tanggal_realisasi or None,
        "target_db": args.target_db or None,
        "target_table": args.target_table or None,
        "engine": args.engine or "MergeTree",
        "order_by": args.order_by or None,
    }

    if args.raw_text_file:
        p = Path(args.raw_text_file)
        if p.exists():
            params["raw_text"] = p.read_text(encoding="utf-8", errors="replace")

    if args.json_params:
        extra = json.loads(args.json_params)
        if isinstance(extra, dict):
            params.update({k: v for k, v in extra.items() if v is not None})

    module = PIPELINES[args.pipeline]
    try:
        result = module.run(**params)
        sys.stdout.write(json.dumps(result, ensure_ascii=False))
        sys.stdout.flush()
        return 0
    except Exception as exc:
        err_payload = {
            "status": "error",
            "pipeline": args.pipeline,
            "action": args.action,
            "columns": [],
            "rows": [],
            "total_rows": 0,
            "csv_path": None,
            "csv_filename": None,
            "summary": {},
            "message": str(exc) or "Terjadi kesalahan saat mengeksekusi pipeline Python.",
        }
        sys.stdout.write(json.dumps(err_payload, ensure_ascii=False))
        sys.stdout.flush()
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
