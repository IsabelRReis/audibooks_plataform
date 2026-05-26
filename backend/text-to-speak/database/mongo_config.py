import os
import wave
from datetime import datetime, timezone

from bson import ObjectId
from dotenv import load_dotenv
from pymongo import DESCENDING, MongoClient
from pymongo.errors import DuplicateKeyError

# Carrega as variaveis do arquivo .env
load_dotenv()


class MongoDatabase:
    def __init__(self):
        # Substitua pela sua URL do MongoDB Atlas ou Local
        self.uri = os.getenv("MONGO_URI", "mongodb://localhost:27017/")
        timeout_ms = int(os.getenv("MONGO_TIMEOUT_MS", "5000"))
        self.client = MongoClient(self.uri, serverSelectionTimeoutMS=timeout_ms)
        self.db = self.client["conversor_audiobooks"]

        # Legado
        self.collection = self.db["books"]
        self.uploads_collection = self.db["pdf_uploads"]

        # Modelo normalizado (US-12)
        self.users_collection = self.db["users"]
        self.audiobooks_collection = self.db["audiobooks"]
        self.tracks_collection = self.db["tracks"]
        self.permissions_collection = self.db["permissions"]

        self.cascade_delete_on_audiobook_delete = (
            os.getenv("CASCADE_DELETE_ON_AUDIOBOOK_DELETE", "true").strip().lower() == "true"
        )

        try:
            self.users_collection.create_index("email", unique=True)
            self.audiobooks_collection.create_index("source_upload_id", unique=True)
            self.tracks_collection.create_index("audiobook_id")
            self.permissions_collection.create_index([("user_id", 1), ("audiobook_id", 1)], unique=True)
            self.permissions_collection.create_index("user_id")
            self.permissions_collection.create_index("audiobook_id")
        except Exception as e:
            print(f"Aviso ao criar indices: {e}")

    def salvar_audiobook(self, audiobook_obj):
        """Recebe a instancia da classe Audiobook e salva no banco (legado)."""
        try:
            dados = audiobook_obj.to_dict()
            resultado = self.collection.insert_one(dados)
            return resultado.inserted_id
        except Exception as e:
            print(f"Erro ao salvar no MongoDB: {e}")
            return None

    # Users
    def create_user(self, user_data):
        """Salva um usuario. Retorna None quando e-mail ja existe."""
        try:
            user_data.setdefault("role", "user")
            result = self.users_collection.insert_one(user_data)
            return result.inserted_id
        except DuplicateKeyError:
            return None

    def find_user_by_email(self, email):
        return self.users_collection.find_one({"email": email})

    def find_user_by_id(self, user_id):
        try:
            return self.users_collection.find_one({"_id": ObjectId(user_id)})
        except Exception:
            return None

    def list_users(self):
        cursor = self.users_collection.find({}, {"email": 1, "name": 1, "profile": 1, "role": 1}).sort("email", 1)
        users = []
        for user in cursor:
            role = user.get("role")
            if not role:
                role = "admin" if str(user.get("profile", "")).lower() == "admin" else "user"
            users.append(
                {
                    "id": str(user.get("_id")),
                    "name": user.get("name"),
                    "email": user.get("email"),
                    "role": role,
                    "profile": user.get("profile", "Admin" if role == "admin" else "Usuario"),
                    "created_at": user.get("created_at"),
                }
            )
        return users

    def update_user_profile(self, email, name=None, password_hash=None):
        """Atualiza campos do usuário identificado pelo email. Retorna True se modificado."""
        if not email:
            return False

        update_payload = {}
        if name is not None:
            # permite armazenar None para limpar nome
            update_payload["name"] = name
        if password_hash is not None:
            update_payload["password_hash"] = password_hash

        if not update_payload:
            return False

        result = self.users_collection.update_one({"email": email}, {"$set": update_payload})
        return result.modified_count > 0

    def change_user_email(self, old_email, new_email):
        """Tenta alterar o e-mail do usuário. Retorna:
           - True: sucesso
           - 'duplicate': e-mail já existe
           - False: usuário não encontrado
        """
        try:
            result = self.users_collection.update_one({"email": old_email}, {"$set": {"email": new_email}})
            if result.matched_count == 0:
                return False
            return True
        except DuplicateKeyError:
            return "duplicate"

    # Uploads (pipeline legado)
    def create_upload_records(self, records):
        if not records:
            return []

        normalized_records = []
        for record in records:
            normalized_records.append(
                {
                    "filename": record.get("filename"),
                    "stored_filename": record.get("stored_filename"),
                    "file_size_bytes": record.get("file_size_bytes"),
                    "content_type": record.get("content_type"),
                    "uploaded_by": record.get("uploaded_by"),
                    "status": record.get("status", "enviado"),
                    "conversion_total_tracks": 0,
                    "conversion_generated_tracks": 0,
                    "conversion_progress_percent": 0,
                    "created_at": datetime.now(timezone.utc),
                }
            )

        result = self.uploads_collection.insert_many(normalized_records)
        return [str(inserted_id) for inserted_id in result.inserted_ids]

    def update_upload_status(self, upload_id, status, extra_fields=None):
        update_payload = {
            "status": status,
            "updated_at": datetime.now(timezone.utc),
        }
        if extra_fields:
            update_payload.update(extra_fields)

        self.uploads_collection.update_one(
            {"_id": ObjectId(upload_id)},
            {"$set": update_payload},
        )

    # Audiobooks + Tracks (modelo normalizado)
    def upsert_audiobook_from_upload(self, upload_id, title, original_pdf, status, tracks, created_at=None):
        now = datetime.now(timezone.utc)
        self.audiobooks_collection.update_one(
            {"source_upload_id": str(upload_id)},
            {
                "$set": {
                    "title": title,
                    "original_pdf": original_pdf,
                    "status": status,
                    "updated_at": now,
                },
                "$setOnInsert": {
                    "created_at": created_at or now,
                    "source_upload_id": str(upload_id),
                },
            },
            upsert=True,
        )

        audiobook_doc = self.audiobooks_collection.find_one({"source_upload_id": str(upload_id)})
        if not audiobook_doc:
            return None

        audiobook_id = str(audiobook_doc.get("_id"))

        # Mantem integridade referencial de tracks por substituicao total.
        self.tracks_collection.delete_many({"audiobook_id": audiobook_id})
        if tracks:
            rows = []
            for track in tracks:
                rows.append(
                    {
                        "audiobook_id": audiobook_id,
                        "title": track.get("name") or "Faixa",
                        "file_path": track.get("file_path"),
                        "duration": float(track.get("duration_seconds", 0)),
                        "order": int(track.get("order", 0)),
                        "created_at": now,
                    }
                )
            self.tracks_collection.insert_many(rows)

        return audiobook_id

    def list_upload_records(self, limit=200):
        cursor = self.uploads_collection.find({}).sort("created_at", DESCENDING).limit(limit)
        records = []

        for doc in cursor:
            upload_id = str(doc.get("_id"))
            audiobook_doc = self.audiobooks_collection.find_one({"source_upload_id": upload_id})
            audiobook_id = str(audiobook_doc.get("_id")) if audiobook_doc else None

            permissions = []
            if audiobook_id:
                perm_cursor = self.permissions_collection.find({"audiobook_id": audiobook_id})
                for perm in perm_cursor:
                    user = self.find_user_by_id(perm.get("user_id"))
                    permissions.append(
                        {
                            "user_email": user.get("email") if user else perm.get("user_id"),
                            "active": True,
                            "granted_at": perm.get("granted_at"),
                        }
                    )

            records.append(
                {
                    "id": upload_id,
                    "audiobook_id": audiobook_id,
                    "filename": doc.get("filename"),
                    "stored_filename": doc.get("stored_filename"),
                    "file_size_bytes": doc.get("file_size_bytes"),
                    "uploaded_by": doc.get("uploaded_by"),
                    "status": doc.get("status", "enviado"),
                    "error_log": doc.get("error_log"),
                    "created_at": doc.get("created_at"),
                    "updated_at": doc.get("updated_at"),
                    "page_count": doc.get("page_count"),
                    "extraction_status": doc.get("extraction_status"),
                    "ocr_required": doc.get("ocr_required"),
                    "temp_text_path": doc.get("temp_text_path"),
                    "extracted_characters": doc.get("extracted_characters"),
                    "split_strategy": doc.get("split_strategy"),
                    "audio_format": doc.get("audio_format"),
                    "track_count": doc.get("track_count", 0),
                    "total_duration_seconds": doc.get("total_duration_seconds", 0),
                    "conversion_total_tracks": doc.get("conversion_total_tracks", 0),
                    "conversion_generated_tracks": doc.get("conversion_generated_tracks", 0),
                    "conversion_progress_percent": doc.get("conversion_progress_percent", 0),
                    "tracks": doc.get("tracks", []),
                    "permissions": permissions,
                }
            )

        return records

    # Permissions N:N
    def set_upload_permission(self, upload_id, user_email, active=True):
        if not active:
            return self.remove_upload_permission(upload_id, user_email)

        normalized_email = (user_email or "").strip().lower()
        if not normalized_email:
            return False

        user_doc = self.find_user_by_email(normalized_email)
        audiobook_doc = self.audiobooks_collection.find_one({"source_upload_id": str(upload_id)})

        # Integridade referencial: permissao so existe com User e Audiobook validos.
        if not user_doc or not audiobook_doc:
            return False

        user_id = str(user_doc.get("_id"))
        audiobook_id = str(audiobook_doc.get("_id"))

        self.permissions_collection.update_one(
            {
                "user_id": user_id,
                "audiobook_id": audiobook_id,
            },
            {
                        "$set": {"granted_at": datetime.now(timezone.utc)},
                "$setOnInsert": {
                    "user_id": user_id,
                    "audiobook_id": audiobook_id,
                },
            },
            upsert=True,
        )
        return True

    def set_upload_permissions_bulk(self, upload_id, user_emails, active=True):
        updated_count = 0
        for user_email in user_emails:
            if self.set_upload_permission(upload_id, user_email, active=active):
                updated_count += 1
        return updated_count

    def remove_upload_permission(self, upload_id, user_email):
        normalized_email = (user_email or "").strip().lower()
        if not normalized_email:
            return False

        user_doc = self.find_user_by_email(normalized_email)
        audiobook_doc = self.audiobooks_collection.find_one({"source_upload_id": str(upload_id)})
        if not user_doc or not audiobook_doc:
            return False

        result = self.permissions_collection.delete_one(
            {
                "user_id": str(user_doc.get("_id")),
                "audiobook_id": str(audiobook_doc.get("_id")),
            }
        )
        return result.deleted_count > 0

    # Biblioteca
    def ensure_owner_permissions_for_ready_uploads(self, user_email):
        normalized_email = (user_email or "").strip().lower()
        if not normalized_email:
            return 0

        user_doc = self.find_user_by_email(normalized_email)
        if not user_doc:
            return 0

        user_id = str(user_doc.get("_id"))
        updated_count = 0

        ready_uploads = self.uploads_collection.find(
            {
                "uploaded_by": normalized_email,
                "status": "pronto",
            },
            {"_id": 1},
        )

        for upload_doc in ready_uploads:
            upload_id = str(upload_doc.get("_id"))
            audiobook_doc = self.audiobooks_collection.find_one({"source_upload_id": upload_id}, {"_id": 1})
            if not audiobook_doc:
                continue

            audiobook_id = str(audiobook_doc.get("_id"))
            result = self.permissions_collection.update_one(
                {
                    "user_id": user_id,
                    "audiobook_id": audiobook_id,
                },
                {
                    "$setOnInsert": {
                        "user_id": user_id,
                        "audiobook_id": audiobook_id,
                        "granted_at": datetime.now(timezone.utc),
                    }
                },
                upsert=True,
            )

            if result.upserted_id is not None:
                updated_count += 1

        return updated_count

    def list_user_library(self, user_email):
        normalized_email = (user_email or "").strip().lower()
        user_doc = self.find_user_by_email(normalized_email)
        if not user_doc:
            return []

        user_id = str(user_doc.get("_id"))
        perm_cursor = self.permissions_collection.find({"user_id": user_id})
        audiobook_ids = [perm.get("audiobook_id") for perm in perm_cursor]
        if not audiobook_ids:
            return []

        cursor = self.audiobooks_collection.find(
            {
                "_id": {"$in": [ObjectId(audiobook_id) for audiobook_id in audiobook_ids]},
                "status": "pronto",
            }
        ).sort("updated_at", DESCENDING)

        return self._build_library_items(cursor)

    def list_all_active_library(self):
        perm_cursor = self.permissions_collection.find({})
        audiobook_ids = [perm.get("audiobook_id") for perm in perm_cursor]
        if not audiobook_ids:
            return []

        cursor = self.audiobooks_collection.find(
            {
                "_id": {"$in": [ObjectId(audiobook_id) for audiobook_id in audiobook_ids]},
                "status": "pronto",
            }
        ).sort("updated_at", DESCENDING)

        return self._build_library_items(cursor)

    def list_tracks_for_user_audiobook(self, audiobook_id, user_email, allow_admin=False):
        """Retorna faixas de um audiobook somente se usuario tiver permissao."""
        normalized_email = (user_email or "").strip().lower()

        if allow_admin:
            has_access = True
        else:
            user_doc = self.find_user_by_email(normalized_email)
            if not user_doc:
                return []

            permission = self.permissions_collection.find_one(
                {
                    "user_id": str(user_doc.get("_id")),
                    "audiobook_id": audiobook_id,
                }
            )
            has_access = permission is not None

        if not has_access:
            return []

        cursor = self.tracks_collection.find({"audiobook_id": audiobook_id}).sort("order", 1)
        tracks = []
        for track in cursor:
            file_path = track.get("file_path") or ""
            real_duration = self._get_real_audio_duration(file_path)
            duration_value = float(track.get("duration", 0) or 0)

            # Sincroniza metadado legado com duracao real do arquivo quando houver divergencia.
            if real_duration is not None and abs(real_duration - duration_value) > 0.05:
                duration_value = round(real_duration, 2)
                self.tracks_collection.update_one(
                    {"_id": track.get("_id")},
                    {
                        "$set": {
                            "duration": duration_value,
                        }
                    },
                )

            tracks.append(
                {
                    "id": str(track.get("_id")),
                    "title": track.get("title"),
                    "order": track.get("order"),
                    "duration": duration_value,
                    "file_path": file_path,
                    "file_name": os.path.basename(file_path) if file_path else None,
                }
            )

        return tracks

    def get_track_for_user(self, track_id, user_email, allow_admin=False):
        """Retorna uma faixa especifica somente quando o usuario possui permissao."""
        try:
            track_doc = self.tracks_collection.find_one({"_id": ObjectId(track_id)})
        except Exception:
            return None

        if not track_doc:
            return None

        audiobook_id = track_doc.get("audiobook_id")
        if not audiobook_id:
            return None

        tracks = self.list_tracks_for_user_audiobook(
            audiobook_id=audiobook_id,
            user_email=user_email,
            allow_admin=allow_admin,
        )
        for track in tracks:
            if track.get("id") == str(track_doc.get("_id")):
                return track

        return None

    def _user_can_manage_audiobook(self, audiobook_doc, user_email, allow_admin=False):
        if not audiobook_doc:
            return False

        if allow_admin:
            return True

        source_upload_id = str(audiobook_doc.get("source_upload_id") or "")
        if not source_upload_id:
            return False

        upload_doc = self.uploads_collection.find_one({"_id": ObjectId(source_upload_id)})
        if not upload_doc:
            return False

        owner_email = (upload_doc.get("uploaded_by") or "").strip().lower()
        return owner_email == (user_email or "").strip().lower()

    def delete_track_for_user(self, track_id, user_email, allow_admin=False):
        try:
            track_doc = self.tracks_collection.find_one({"_id": ObjectId(track_id)})
        except Exception:
            return False, "track_not_found"

        if not track_doc:
            return False, "track_not_found"

        audiobook_id = str(track_doc.get("audiobook_id") or "")
        try:
            audiobook_doc = self.audiobooks_collection.find_one({"_id": ObjectId(audiobook_id)})
        except Exception:
            audiobook_doc = None

        if not self._user_can_manage_audiobook(audiobook_doc, user_email, allow_admin=allow_admin):
            return False, "forbidden"

        file_path = track_doc.get("file_path")
        if file_path:
            try:
                os.remove(file_path)
            except FileNotFoundError:
                pass
            except Exception:
                pass

        self.tracks_collection.delete_one({"_id": track_doc.get("_id")})
        return True, "deleted"

    def delete_ready_audiobook_for_user(self, audiobook_id, user_email, allow_admin=False):
        try:
            audiobook_doc = self.audiobooks_collection.find_one({"_id": ObjectId(audiobook_id)})
        except Exception:
            return False, "audiobook_not_found"

        if not audiobook_doc:
            return False, "audiobook_not_found"

        if str(audiobook_doc.get("status") or "") != "pronto":
            return False, "audiobook_not_ready"

        if not self._user_can_manage_audiobook(audiobook_doc, user_email, allow_admin=allow_admin):
            return False, "forbidden"

        source_upload_id = str(audiobook_doc.get("source_upload_id") or "")

        tracks = list(self.tracks_collection.find({"audiobook_id": str(audiobook_doc.get("_id"))}))
        for track in tracks:
            track_file = track.get("file_path")
            if track_file:
                try:
                    os.remove(track_file)
                except FileNotFoundError:
                    pass
                except Exception:
                    pass

        self.tracks_collection.delete_many({"audiobook_id": str(audiobook_doc.get("_id"))})
        self.permissions_collection.delete_many({"audiobook_id": str(audiobook_doc.get("_id"))})
        self.audiobooks_collection.delete_one({"_id": audiobook_doc.get("_id")})

        if source_upload_id:
            try:
                self.uploads_collection.update_one(
                    {"_id": ObjectId(source_upload_id)},
                    {
                        "$set": {
                            "status": "enviado",
                            "tracks": [],
                            "track_count": 0,
                            "total_duration_seconds": 0,
                            "updated_at": datetime.now(timezone.utc),
                            "error_log": "Audiobook removido pelo usuário.",
                        }
                    },
                )
            except Exception:
                pass

        return True, "deleted"

    def _build_library_items(self, cursor):
        items = []
        for doc in cursor:
            audiobook_id = str(doc.get("_id"))
            tracks = list(self.tracks_collection.find({"audiobook_id": audiobook_id}).sort("order", 1))
            total_duration_seconds = 0.0
            for track in tracks:
                file_path = track.get("file_path") or ""
                real_duration = self._get_real_audio_duration(file_path)
                duration_value = float(track.get("duration", 0) or 0)

                if real_duration is not None and abs(real_duration - duration_value) > 0.05:
                    duration_value = round(real_duration, 2)
                    self.tracks_collection.update_one(
                        {"_id": track.get("_id")},
                        {
                            "$set": {
                                "duration": duration_value,
                            }
                        },
                    )

                total_duration_seconds += duration_value

            audio_format = None
            if tracks and tracks[0].get("file_path"):
                audio_format = tracks[0].get("file_path").split(".")[-1]

            items.append(
                {
                    "id": audiobook_id,
                    "title": doc.get("title") or "Sem titulo",
                    "track_count": len(tracks),
                    "total_duration_seconds": round(total_duration_seconds, 2),
                    "audio_format": audio_format,
                    "updated_at": doc.get("updated_at"),
                }
            )

        return items

    def _get_real_audio_duration(self, file_path):
        if not file_path:
            return None

        try:
            if not os.path.isfile(file_path):
                return None

            _, extension = os.path.splitext(file_path)
            extension = (extension or "").lower()

            if extension != ".wav":
                return None

            with wave.open(file_path, "rb") as wav_file:
                frame_rate = wav_file.getframerate()
                frame_count = wav_file.getnframes()
                if frame_rate <= 0:
                    return None

                return frame_count / float(frame_rate)
        except Exception:
            return None

    # Exclusao com cascata configuravel
    def delete_audiobook(self, audiobook_id, cascade=None):
        cascade_enabled = self.cascade_delete_on_audiobook_delete if cascade is None else bool(cascade)

        audiobook_doc = self.audiobooks_collection.find_one({"_id": ObjectId(audiobook_id)})
        if not audiobook_doc:
            return False, "audiobook_not_found"

        has_tracks = self.tracks_collection.count_documents({"audiobook_id": audiobook_id}) > 0
        has_permissions = self.permissions_collection.count_documents({"audiobook_id": audiobook_id}) > 0

        if not cascade_enabled and (has_tracks or has_permissions):
            return False, "related_records_exist"

        self.audiobooks_collection.delete_one({"_id": ObjectId(audiobook_id)})

        if cascade_enabled:
            self.tracks_collection.delete_many({"audiobook_id": audiobook_id})
            self.permissions_collection.delete_many({"audiobook_id": audiobook_id})

        return True, "deleted"


# Instancia global para ser usada no projeto
db_helper = MongoDatabase()
