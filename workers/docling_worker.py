"""Optional OCR / layout worker. Install requirements and configure a supervised worker.
This extracts document structure only; accounting fields still require review.
"""
import argparse
from pathlib import Path
from docling.document_converter import DocumentConverter

parser = argparse.ArgumentParser()
parser.add_argument("--input", required=True)
parser.add_argument("--output", required=True)
args = parser.parse_args()
source = Path(args.input).resolve(strict=True)
destination = Path(args.output).resolve()
if source.suffix.lower() not in {".pdf", ".png", ".jpg", ".jpeg", ".docx", ".xlsx"}:
    raise ValueError("Unsupported source format")
result = DocumentConverter().convert(str(source))
destination.write_text(result.document.export_to_markdown(), encoding="utf-8")

