import app_main


class _FakePage:
    def __init__(self, text):
        self._text = text

    def extract_text(self):
        return self._text


class _FakePdf:
    def __init__(self, pages):
        self.pages = pages

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False


def test_process_uploaded_pdf_uses_ocr_when_native_text_is_missing(tmp_path, fake_db, monkeypatch):
    upload_id = "upload-ocr-1"
    stored_filename = "scan.pdf"
    file_path = tmp_path / "uploads" / stored_filename
    file_path.write_bytes(b"%PDF-1.4 fake scan")

    fake_db.uploads[upload_id] = {
        "_id": upload_id,
        "filename": "scan.pdf",
        "stored_filename": stored_filename,
        "file_size_bytes": file_path.stat().st_size,
        "content_type": "application/pdf",
        "uploaded_by": "admin@example.com",
        "status": "enviado",
        "created_at": None,
        "updated_at": None,
    }

    monkeypatch.setattr(
        app_main.pdfplumber,
        "open",
        lambda _path: _FakePdf([_FakePage(""), _FakePage("")]),
    )
    monkeypatch.setattr(app_main, "_ocr_extract_page_text", lambda _path, page_number: f"Texto OCR {page_number}")
    monkeypatch.setattr(app_main, "_generate_audio_tracks", lambda *args, **kwargs: [
        {"name": "Faixa 1", "order": 1, "duration_seconds": 12.0, "format": "wav", "file_name": "1.wav", "file_path": str(tmp_path / "audios" / "1.wav")}
    ])

    app_main._original_process_uploaded_pdf(upload_id, stored_filename, uploader_email="admin@example.com")

    upload_doc = fake_db.uploads[upload_id]
    assert upload_doc["status"] == "pronto"
    assert upload_doc["ocr_required"] is False
    assert upload_doc["extraction_status"] == "ocr"
    assert upload_doc["track_count"] == 1

    temp_text = tmp_path / "temp_text" / f"{upload_id}.txt"
    assert temp_text.exists()
    assert "Texto OCR" in temp_text.read_text(encoding="utf-8")