import os
import uuid
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient
import importlib.util
import sys
from pathlib import Path

# Carrega o módulo main.py por caminho para evitar problemas com nomes de pacote
pkg_dir = Path(__file__).resolve().parent.parent
main_path = pkg_dir / "main.py"
spec = importlib.util.spec_from_file_location("app_main", str(main_path))
app_main = importlib.util.module_from_spec(spec)
# Ensure the package dir is on sys.path so imports like `database.xxx` resolve
sys.path.insert(0, str(pkg_dir))

# During tests, ensure a sufficiently long JWT secret to avoid InsecureKeyLengthWarning
os.environ.setdefault("JWT_SECRET", "test-secret-please-change-in-production-" + "0" * 40)

sys.modules["app_main"] = app_main
spec.loader.exec_module(app_main)


class FakeDB:
    def __init__(self):
        self.users = {}
        self.uploads = {}
        self.audiobooks = {}
        self.tracks = {}
        self.permissions = {}

    # Users
    def create_user(self, user_data):
        email = (user_data.get("email") or "").strip().lower()
        if not email or email in self.users:
            return None
        user_id = uuid.uuid4().hex
        user_doc = {**user_data}
        user_doc["_id"] = user_id
        self.users[email] = user_doc
        return user_id

    def find_user_by_email(self, email):
        if not email:
            return None
        return self.users.get(email.strip().lower())

    def find_user_by_id(self, user_id):
        for u in self.users.values():
            if u.get("_id") == user_id:
                return u
        return None

    def list_users(self):
        out = []
        for u in self.users.values():
            out.append({
                "id": str(u.get("_id")),
                "email": u.get("email"),
                "name": u.get("name"),
                "profile": u.get("profile"),
                "role": u.get("role"),
                "created_at": u.get("created_at"),
            })
        return out

    def update_user_profile(self, email, name=None, password_hash=None):
        user = self.find_user_by_email(email)
        if not user:
            return False
        if name is not None:
            user["name"] = name
        if password_hash is not None:
            user["password_hash"] = password_hash
        return True

    def change_user_email(self, old_email, new_email):
        u = self.find_user_by_email(old_email)
        if not u:
            return False
        new_norm = (new_email or "").strip().lower()
        if new_norm in self.users and new_norm != old_email:
            return "duplicate"
        del self.users[old_email]
        u["email"] = new_norm
        self.users[new_norm] = u
        return True

    # Uploads
    def create_upload_records(self, records):
        ids = []
        for rec in records:
            uid = uuid.uuid4().hex
            now = datetime.now(timezone.utc)
            doc = {
                "_id": uid,
                "filename": rec.get("filename"),
                "stored_filename": rec.get("stored_filename"),
                "file_size_bytes": rec.get("file_size_bytes"),
                "content_type": rec.get("content_type"),
                "uploaded_by": rec.get("uploaded_by"),
                "status": rec.get("status", "enviado"),
                "created_at": now,
                "updated_at": now,
            }
            self.uploads[uid] = doc
            ids.append(uid)
        return ids

    def list_upload_records(self, limit=200):
        # Return newest first
        items = list(self.uploads.values())[::-1]
        out = []
        for d in items[:limit]:
            out.append({
                "id": str(d.get("_id")),
                "filename": d.get("filename"),
                "stored_filename": d.get("stored_filename"),
                "file_size_bytes": d.get("file_size_bytes"),
                "uploaded_by": d.get("uploaded_by"),
                "status": d.get("status"),
                "created_at": d.get("created_at"),
                "updated_at": d.get("updated_at"),
                "track_count": d.get("track_count", 0),
                "tracks": d.get("tracks", []),
                "permissions": [],
            })
        return out

    def update_upload_status(self, upload_id, status, extra_fields=None):
        doc = self.uploads.get(upload_id)
        if doc is None:
            for candidate in self.uploads.values():
                if candidate.get("_id") == upload_id:
                    doc = candidate
                    break
        if not doc:
            return
        doc["status"] = status
        doc["updated_at"] = datetime.now(timezone.utc)
        if extra_fields:
            doc.update(extra_fields)

    def upsert_audiobook_from_upload(self, upload_id, title, original_pdf, status, tracks, created_at=None):
        now = datetime.now(timezone.utc)
        audiobook = self.audiobooks.get(upload_id)
        if audiobook is None:
            audiobook = {
                "_id": uuid.uuid4().hex,
                "source_upload_id": str(upload_id),
                "created_at": created_at or now,
            }
            self.audiobooks[upload_id] = audiobook

        audiobook.update({
            "title": title,
            "original_pdf": original_pdf,
            "status": status,
            "updated_at": now,
            "tracks": tracks,
        })
        return audiobook["_id"]

    def set_upload_permission(self, upload_id, user_email, active=True):
        return True

    def set_upload_permissions_bulk(self, upload_id, user_emails, active=True):
        return len(user_emails)


@pytest.fixture()
def fake_db(tmp_path, monkeypatch):
    db = FakeDB()

    # Ensure upload/audios/temp dirs point to tmp_path
    monkeypatch.setattr(app_main, "UPLOADS_DIR", tmp_path / "uploads")
    monkeypatch.setattr(app_main, "AUDIOS_DIR", tmp_path / "audios")
    monkeypatch.setattr(app_main, "TEMP_TEXT_DIR", tmp_path / "temp_text")
    (tmp_path / "uploads").mkdir()
    (tmp_path / "audios").mkdir()
    (tmp_path / "temp_text").mkdir()

    # Replace db_helper and processing function
    monkeypatch.setattr(app_main, "db_helper", db)
    app_main._original_process_uploaded_pdf = app_main.process_uploaded_pdf
    monkeypatch.setattr(app_main, "process_uploaded_pdf", lambda *a, **k: None)

    return db


@pytest.fixture()
def client(fake_db):
    return TestClient(app_main.app)
