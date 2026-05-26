import base64
import hashlib
import hmac
import logging
import os
import re
import uuid
import wave
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Callable

import jwt
import pdfplumber
from dotenv import load_dotenv
from fastapi import BackgroundTasks, Depends, FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel
from typing import Optional

load_dotenv()

from database.mongo_config import db_helper

EMAIL_REGEX = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
MIN_PASSWORD_LENGTH = 8
JWT_SECRET = os.getenv("JWT_SECRET", "change-this-secret-in-production")
JWT_ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "60"))
MAX_UPLOAD_SIZE_MB = int(os.getenv("MAX_UPLOAD_SIZE_MB", "25"))
MAX_UPLOAD_SIZE_BYTES = MAX_UPLOAD_SIZE_MB * 1024 * 1024
PAGES_PER_TRACK = int(os.getenv("PAGES_PER_TRACK", "5"))
WORDS_PER_SECOND = float(os.getenv("WORDS_PER_SECOND", "2.6"))
AUDIO_OUTPUT_FORMAT = os.getenv("AUDIO_OUTPUT_FORMAT", "wav").lower()
UPLOADS_DIR = Path(__file__).resolve().parent / "uploads"
LOGS_DIR = Path(__file__).resolve().parent / "logs"
PROCESSING_LOG_FILE = LOGS_DIR / "processing.log"
TEMP_TEXT_DIR = Path(__file__).resolve().parent / "temp_text"
AUDIOS_DIR = Path(__file__).resolve().parent / "audios"
VOICES_DIR = Path(__file__).resolve().parent / "voices" / "pt-br"
PIPER_MODEL_PATH = Path(
    os.getenv("PIPER_MODEL_PATH", str(VOICES_DIR / "pt_BR-faber-medium.onnx"))
)
PIPER_CONFIG_PATH = Path(
    os.getenv("PIPER_CONFIG_PATH", str(VOICES_DIR / "pt_BR-faber-medium.onnx.json"))
)

CHAPTER_PATTERN = re.compile(r"(?im)^(cap[ií]tulo\s+[\w\-\.]+|chapter\s+[\w\-\.]+)")
OCR_DPI = int(os.getenv("OCR_DPI", "200"))
OCR_LANGUAGE = os.getenv("OCR_LANGUAGE", "por+eng")

PROFILE_REDIRECT_MAP = {
    "Admin": "/admin-dashboard.html",
    "Usuário": "/index.html",
    "Usuario": "/index.html",
}


def _parse_cors_origins(value: str | None) -> list[str]:
    if not value:
        return ["http://127.0.0.1:5500", "http://localhost:5500"]

    origins = [item.strip() for item in value.split(",") if item.strip()]
    return origins or ["http://127.0.0.1:5500", "http://localhost:5500"]


CORS_ORIGINS = _parse_cors_origins(os.getenv("CORS_ORIGINS"))

security = HTTPBearer(auto_error=False)
_piper_voice = None


class RegisterRequest(BaseModel):
    email: str
    password: str
    name: str | None = None


class LoginRequest(BaseModel):
    email: str
    password: str


class GrantLibraryPermissionRequest(BaseModel):
    upload_id: str
    user_email: str
    active: bool = True


class GrantLibraryPermissionBulkRequest(BaseModel):
    upload_id: str
    user_emails: list[str]
    active: bool = True


class UpdateUserRequest(BaseModel):
    name: Optional[str] = None
    password: Optional[str] = None
    email: Optional[str] = None


def _normalize_email(email: str) -> str:
    return email.strip().lower()


def _validate_email(email: str) -> bool:
    return bool(EMAIL_REGEX.match(email))


def _hash_password(password: str) -> str:
    salt = os.urandom(16)
    hashed = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 100_000)
    return f"{base64.b64encode(salt).decode()}:{base64.b64encode(hashed).decode()}"


def _verify_password(password: str, hashed_password: str) -> bool:
    try:
        salt_b64, hash_b64 = hashed_password.split(":", 1)
        salt = base64.b64decode(salt_b64)
        expected_hash = base64.b64decode(hash_b64)
    except (ValueError, TypeError):
        return False

    current_hash = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 100_000)
    return hmac.compare_digest(current_hash, expected_hash)


def _create_access_token(email: str, profile: str) -> str:
    now = datetime.now(timezone.utc)
    expires = now + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    payload = {
        "sub": email,
        "profile": profile,
        "iat": int(now.timestamp()),
        "exp": int(expires.timestamp()),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def _create_stream_token(track_id: str, email: str, expires_minutes: int = 120) -> str:
    now = datetime.now(timezone.utc)
    expires = now + timedelta(minutes=max(1, expires_minutes))
    payload = {
        "track_id": track_id,
        "email": _normalize_email(email),
        "iat": int(now.timestamp()),
        "exp": int(expires.timestamp()),
        "type": "stream",
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def _decode_stream_token(token: str):
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError as exc:
        raise HTTPException(status_code=401, detail="Link de stream expirado.") from exc
    except jwt.PyJWTError as exc:
        raise HTTPException(status_code=401, detail="Link de stream inválido.") from exc

    if payload.get("type") != "stream":
        raise HTTPException(status_code=401, detail="Token de stream inválido.")

    track_id = payload.get("track_id")
    email = payload.get("email")
    if not track_id or not email:
        raise HTTPException(status_code=401, detail="Token de stream incompleto.")

    return {
        "track_id": str(track_id),
        "email": _normalize_email(str(email)),
    }


def _decode_access_token(token: str):
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError as exc:
        raise HTTPException(status_code=401, detail="Sessão expirada. Faça login novamente.") from exc
    except jwt.PyJWTError as exc:
        raise HTTPException(status_code=401, detail="Token inválido ou expirado.") from exc


def _normalize_profile(profile: str | None) -> str:
    if profile == "Usuario":
        return "Usuário"
    return profile or "Usuário"


def _get_redirect_for_profile(profile: str) -> str:
    return PROFILE_REDIRECT_MAP.get(profile, "/index.html")


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
    token: str | None = Query(default=None),
):
    raw_token = None
    if credentials and credentials.credentials:
        raw_token = credentials.credentials
    elif token:
        raw_token = token

    if not raw_token:
        raise HTTPException(status_code=401, detail="Token de acesso ausente.")

    payload = _decode_access_token(raw_token)
    email = payload.get("sub")

    if not email:
        raise HTTPException(status_code=401, detail="Token inválido.")

    user = db_helper.find_user_by_email(email)
    if not user:
        raise HTTPException(status_code=401, detail="Usuário da sessão não encontrado.")

    return {
        "email": user.get("email"),
        "profile": _normalize_profile(user.get("profile")),
        "token_exp": payload.get("exp"),
    }


def require_roles(*allowed_roles: str, allow_admin_override: bool = True) -> Callable:
    normalized_allowed = {_normalize_profile(role) for role in allowed_roles}

    def authorization_dependency(current_user=Depends(get_current_user)):
        user_profile = _normalize_profile(current_user.get("profile"))

        if user_profile == "Admin" and allow_admin_override:
            return current_user

        if user_profile not in normalized_allowed:
            raise HTTPException(status_code=403, detail="Acesso negado para este perfil.")

        return current_user

    return authorization_dependency


app = FastAPI(title="Audiobook API")
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
LOGS_DIR.mkdir(parents=True, exist_ok=True)
TEMP_TEXT_DIR.mkdir(parents=True, exist_ok=True)
AUDIOS_DIR.mkdir(parents=True, exist_ok=True)

processing_logger = logging.getLogger("upload-processing")
processing_logger.setLevel(logging.INFO)
if not processing_logger.handlers:
    file_handler = logging.FileHandler(PROCESSING_LOG_FILE, encoding="utf-8")
    file_handler.setFormatter(
        logging.Formatter("%(asctime)s | %(levelname)s | %(message)s")
    )
    processing_logger.addHandler(file_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health_check():
    return {"status": "ok"}


@app.post("/auth/register", status_code=201)
def register_user(payload: RegisterRequest):
    email = _normalize_email(payload.email)
    password = payload.password

    if not _validate_email(email):
        raise HTTPException(status_code=400, detail="E-mail inválido.")

    if len(password) < MIN_PASSWORD_LENGTH:
        raise HTTPException(status_code=400, detail="A senha deve ter no mínimo 8 caracteres.")

    user_document = {
        "email": email,
        "password_hash": _hash_password(password),
        "role": "user",
        "profile": "Usuário",
        "name": payload.name.strip() if payload.name else None,
        "created_at": datetime.now(timezone.utc),
    }

    inserted_id = db_helper.create_user(user_document)
    if inserted_id is None:
        raise HTTPException(status_code=409, detail="E-mail já cadastrado.")

    return {
        "message": "Usuário cadastrado com sucesso.",
        "redirect_to": "/login.html",
        "user_id": str(inserted_id),
    }


@app.post("/auth/login")
def login_user(payload: LoginRequest):
    email = _normalize_email(payload.email)
    user = db_helper.find_user_by_email(email)

    if not user or not _verify_password(payload.password, user.get("password_hash", "")):
        raise HTTPException(status_code=401, detail="Credenciais inválidas.")

    profile = _normalize_profile(user.get("profile", "Usuário"))
    redirect_to = _get_redirect_for_profile(profile)
    access_token = _create_access_token(email, profile)

    return {
        "message": "Login realizado com sucesso.",
        "profile": profile,
        "email": user.get("email"),
        "redirect_to": redirect_to,
        "access_token": access_token,
        "token_type": "bearer",
        "expires_in": ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    }


@app.get("/auth/session/me")
def current_session(credentials: HTTPAuthorizationCredentials = Depends(security)):
    payload = _decode_access_token(credentials.credentials)
    # Try to include user `name` if available in database
    email = payload.get("sub")
    name = None
    try:
        user = db_helper.find_user_by_email(email)
        if user:
            name = user.get("name")
    except Exception:
        name = None

    return {
        "email": email,
        "profile": _normalize_profile(payload.get("profile")),
        "expires_at": payload.get("exp"),
        "name": name,
    }


@app.get("/library/area")
def user_library_area(current_user=Depends(require_roles("Usuário"))):
    return {
        "message": "Área da biblioteca liberada.",
        "email": current_user.get("email"),
        "profile": current_user.get("profile"),
    }


@app.get("/library/audiobooks")
def list_user_audiobooks(current_user=Depends(require_roles("Usuário"))):
    profile = current_user.get("profile")
    email = current_user.get("email")

    if profile == "Admin":
        items = db_helper.list_all_active_library()
    else:
        db_helper.ensure_owner_permissions_for_ready_uploads(email)
        items = db_helper.list_user_library(email)

    return {
        "items": items,
        "count": len(items),
    }


@app.get("/library/audiobooks/{audiobook_id}/tracks")
def list_user_audiobook_tracks(audiobook_id: str, current_user=Depends(require_roles("Usuário"))):
    profile = current_user.get("profile")
    email = current_user.get("email")

    tracks = db_helper.list_tracks_for_user_audiobook(
        audiobook_id=audiobook_id,
        user_email=email,
        allow_admin=(profile == "Admin"),
    )

    if not tracks:
        raise HTTPException(status_code=404, detail="Faixas não encontradas ou acesso não permitido.")

    payload = []
    for track in tracks:
        track_id = track.get("id")
        stream_token = _create_stream_token(track_id=str(track_id), email=email)
        payload.append(
            {
                "id": track_id,
                "title": track.get("title"),
                "order": track.get("order"),
                "duration": track.get("duration"),
                "stream_url": f"/library/tracks/{track_id}/stream-public?st={stream_token}",
            }
        )

    return {
        "tracks": payload,
        "count": len(payload),
    }


@app.get("/library/tracks/{track_id}/stream")
def stream_track(track_id: str, current_user=Depends(require_roles("Usuário"))):
    profile = current_user.get("profile")
    email = current_user.get("email")

    track = db_helper.get_track_for_user(
        track_id=track_id,
        user_email=email,
        allow_admin=(profile == "Admin"),
    )
    if not track:
        raise HTTPException(status_code=403, detail="Sem permissão para acessar esta faixa.")

    file_path = Path(track.get("file_path") or "")
    if not file_path.exists() or not file_path.is_file():
        raise HTTPException(status_code=404, detail="Arquivo de áudio não encontrado.")

    try:
        resolved_file = file_path.resolve()
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Caminho de arquivo inválido.") from exc

    try:
        audios_root = AUDIOS_DIR.resolve()
        resolved_file.relative_to(audios_root)
    except Exception as exc:
        raise HTTPException(status_code=403, detail="Acesso ao arquivo não permitido.") from exc

    suffix = resolved_file.suffix.lower()
    media_type = "audio/mpeg" if suffix == ".mp3" else "audio/wav"
    return FileResponse(path=str(resolved_file), media_type=media_type, filename=resolved_file.name)


@app.get("/library/tracks/{track_id}/stream-public")
def stream_track_public(track_id: str, st: str = Query(...)):
    stream_claims = _decode_stream_token(st)
    if stream_claims.get("track_id") != str(track_id):
        raise HTTPException(status_code=401, detail="Link de stream não corresponde à faixa.")

    email = stream_claims.get("email")
    track = db_helper.get_track_for_user(
        track_id=track_id,
        user_email=email,
        allow_admin=False,
    )
    if not track:
        raise HTTPException(status_code=403, detail="Sem permissão para acessar esta faixa.")

    file_path = Path(track.get("file_path") or "")
    if not file_path.exists() or not file_path.is_file():
        raise HTTPException(status_code=404, detail="Arquivo de áudio não encontrado.")

    try:
        resolved_file = file_path.resolve()
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Caminho de arquivo inválido.") from exc

    try:
        audios_root = AUDIOS_DIR.resolve()
        resolved_file.relative_to(audios_root)
    except Exception as exc:
        raise HTTPException(status_code=403, detail="Acesso ao arquivo não permitido.") from exc

    suffix = resolved_file.suffix.lower()
    media_type = "audio/mpeg" if suffix == ".mp3" else "audio/wav"
    return FileResponse(path=str(resolved_file), media_type=media_type, filename=resolved_file.name)


@app.delete("/library/tracks/{track_id}")
def delete_user_track(track_id: str, current_user=Depends(require_roles("Admin", allow_admin_override=False))):
    deleted, reason = db_helper.delete_track_for_user(
        track_id=track_id,
        user_email=current_user.get("email"),
        allow_admin=True,
    )

    if not deleted:
        if reason == "forbidden":
            raise HTTPException(status_code=403, detail="Sem permissão para excluir esta faixa.")
        raise HTTPException(status_code=404, detail="Faixa não encontrada.")

    return {
        "message": "Faixa removida com sucesso.",
        "track_id": track_id,
    }


@app.delete("/library/audiobooks/{audiobook_id}")
def delete_user_ready_audiobook(
    audiobook_id: str,
    current_user=Depends(require_roles("Admin", allow_admin_override=False)),
):
    deleted, reason = db_helper.delete_ready_audiobook_for_user(
        audiobook_id=audiobook_id,
        user_email=current_user.get("email"),
        allow_admin=True,
    )

    if not deleted:
        if reason == "forbidden":
            raise HTTPException(status_code=403, detail="Sem permissão para excluir este audiobook.")
        if reason == "audiobook_not_ready":
            raise HTTPException(status_code=409, detail="Apenas audiobooks prontos podem ser removidos.")
        raise HTTPException(status_code=404, detail="Audiobook não encontrado.")

    return {
        "message": "Audiobook removido com sucesso.",
        "audiobook_id": audiobook_id,
    }


@app.post("/upload")
def upload_pdf_admin(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    current_user=Depends(require_roles("Admin", allow_admin_override=False)),
):
    """Endpoint administrativo para enviar PDFs e converter em audiobooks."""
    if not file:
        raise HTTPException(status_code=400, detail="Nenhum arquivo foi enviado.")

    original_name = file.filename or "arquivo.pdf"
    lower_name = original_name.lower()

    if not lower_name.endswith(".pdf"):
        raise HTTPException(
            status_code=400,
            detail=f"Arquivo inválido: {original_name}. Apenas .pdf é permitido.",
        )

    try:
        unique_name = f"{uuid.uuid4().hex}_{Path(original_name).name}"
        output_path = UPLOADS_DIR / unique_name

        bytes_written = 0
        with output_path.open("wb") as destination:
            while True:
                chunk = file.file.read(1024 * 1024)
                if not chunk:
                    break

                bytes_written += len(chunk)
                if bytes_written > MAX_UPLOAD_SIZE_BYTES:
                    destination.close()
                    output_path.unlink(missing_ok=True)
                    raise HTTPException(
                        status_code=400,
                        detail=(
                            f"Arquivo excede o tamanho máximo de {MAX_UPLOAD_SIZE_MB}MB: "
                            f"{original_name}"
                        ),
                    )

                destination.write(chunk)

        record_to_create = {
            "filename": Path(original_name).name,
            "stored_filename": unique_name,
            "file_size_bytes": bytes_written,
            "content_type": file.content_type,
            "uploaded_by": current_user.get("email"),
            "status": "enviado",
        }

        inserted_ids = db_helper.create_upload_records([record_to_create])
        if not inserted_ids:
            output_path.unlink(missing_ok=True)
            raise HTTPException(status_code=500, detail="Falha ao criar registro de upload.")

        upload_id = inserted_ids[0]

        background_tasks.add_task(
            process_uploaded_pdf,
            upload_id,
            unique_name,
            current_user.get("email"),
        )

        return {
            "message": "Upload concluído com sucesso.",
            "id": upload_id,
            "filename": record_to_create["filename"],
            "stored_filename": unique_name,
            "file_size_bytes": bytes_written,
            "status": "enviado",
            "max_size_mb": MAX_UPLOAD_SIZE_MB,
        }
    except HTTPException:
        raise
    except Exception as exc:
        try:
            output_path.unlink(missing_ok=True)
        except Exception:
            pass
        raise HTTPException(status_code=500, detail=f"Erro ao processar upload: {exc}") from exc
    finally:
        if file.file:
            file.file.close()


@app.get("/uploads/personal")
def list_user_uploads(current_user=Depends(require_roles("Usuário"))):
    """Lista uploads do usuário autenticado."""
    user_email = current_user.get("email")
    
    all_uploads = db_helper.list_upload_records()
    
    user_uploads = [
        upload for upload in all_uploads
        if upload.get("uploaded_by", "").lower() == user_email.lower()
    ]
    
    return {
        "uploads": user_uploads,
        "count": len(user_uploads),
    }


@app.get("/admin/area")
def admin_area(current_user=Depends(require_roles("Admin", allow_admin_override=False))):
    return {
        "message": "Área administrativa liberada.",
        "email": current_user.get("email"),
        "profile": current_user.get("profile"),
    }


@app.post("/admin/library/permissions")
def grant_library_permission(
    payload: GrantLibraryPermissionRequest,
    current_user=Depends(require_roles("Admin", allow_admin_override=False)),
):
    updated = db_helper.set_upload_permission(
        upload_id=payload.upload_id,
        user_email=payload.user_email,
        active=payload.active,
    )

    if not updated:
        raise HTTPException(status_code=404, detail="Upload não encontrado para vincular permissão.")

    return {
        "message": "Permissão atualizada com sucesso.",
        "upload_id": payload.upload_id,
        "user_email": payload.user_email.strip().lower(),
        "active": payload.active,
    }


@app.post("/admin/library/permissions/bulk")
def grant_library_permission_bulk(
    payload: GrantLibraryPermissionBulkRequest,
    current_user=Depends(require_roles("Admin", allow_admin_override=False)),
):
    normalized_emails = []
    for email in payload.user_emails:
        normalized = (email or "").strip().lower()
        if normalized:
            normalized_emails.append(normalized)

    normalized_emails = list(dict.fromkeys(normalized_emails))

    if not normalized_emails:
        raise HTTPException(status_code=400, detail="Informe ao menos um usuário para conceder acesso.")

    updated_count = db_helper.set_upload_permissions_bulk(
        upload_id=payload.upload_id,
        user_emails=normalized_emails,
        active=payload.active,
    )

    if updated_count == 0:
        raise HTTPException(status_code=404, detail="Upload não encontrado para vincular permissões.")

    return {
        "message": "Permissões atualizadas com sucesso.",
        "upload_id": payload.upload_id,
        "active": payload.active,
        "updated_count": updated_count,
        "user_emails": normalized_emails,
    }


@app.get("/admin/users")
def list_registered_users(current_user=Depends(require_roles("Admin", allow_admin_override=False))):
    users = db_helper.list_users()
    return {
        "users": users,
        "count": len(users),
    }


@app.patch("/users/me")
def update_current_user(payload: UpdateUserRequest, current_user=Depends(get_current_user)):
    """Atualiza o perfil do usuário autenticado. Aceita `name` e `password`.

    Observação: senha será hasheada antes de salvar.
    """
    email = current_user.get("email")
    if not email:
        raise HTTPException(status_code=401, detail="Usuário não autenticado.")

    updates = {}
    if payload.name is not None:
        name = payload.name.strip() if payload.name else None
        updates["name"] = name

    if payload.password:
        if len(payload.password) < MIN_PASSWORD_LENGTH:
            raise HTTPException(status_code=400, detail=f"A senha deve ter no mínimo {MIN_PASSWORD_LENGTH} caracteres.")
        updates["password_hash"] = _hash_password(payload.password)

    email_changed = False
    new_email = None
    if payload.email:
        new_email = _normalize_email(payload.email)
        if not _validate_email(new_email):
            raise HTTPException(status_code=400, detail="E-mail inválido.")
        if new_email != email:
            email_changed = True

    if not updates:
        return {"message": "Nenhuma alteração enviada."}

    updated = True
    # Update name/password first
    if updates:
        updated = db_helper.update_user_profile(email=email, name=updates.get("name"), password_hash=updates.get("password_hash")) or updated

    if email_changed:
        change_result = db_helper.change_user_email(email, new_email)
        if change_result == "duplicate":
            raise HTTPException(status_code=409, detail="E-mail já em uso por outro usuário.")
        if change_result is False:
            raise HTTPException(status_code=404, detail="Usuário não encontrado.")
        # mark updated for response
        updated = True
    if not updated:
        user_exists = db_helper.find_user_by_email(email)
        if not user_exists:
            raise HTTPException(status_code=404, detail="Usuário não encontrado.")
        return {"message": "Nenhuma alteração aplicada (mesmos valores)."}

    response = {"message": "Perfil atualizado com sucesso."}
    if email_changed:
        response["email_changed"] = True

    return response


@app.delete("/admin/library/permissions")
def revoke_library_permission(
    upload_id: str,
    user_email: str,
    current_user=Depends(require_roles("Admin", allow_admin_override=False)),
):
    removed = db_helper.remove_upload_permission(upload_id=upload_id, user_email=user_email)
    if not removed:
        raise HTTPException(status_code=404, detail="Associação não encontrada para revogação.")

    return {
        "message": "Acesso revogado com sucesso.",
        "upload_id": upload_id,
        "user_email": user_email.strip().lower(),
    }


def _ocr_extract_page_text(file_path: Path, page_number: int) -> str | None:
    try:
        from pdf2image import convert_from_path
        import pytesseract
    except Exception:
        return None

    try:
        images = convert_from_path(
            str(file_path),
            first_page=page_number,
            last_page=page_number,
            dpi=OCR_DPI,
        )
        if not images:
            return None

        image = images[0]
        return (pytesseract.image_to_string(image, lang=OCR_LANGUAGE) or "").strip()
    except Exception as exc:
        processing_logger.warning(
            "Falha ao executar OCR na pagina %s do arquivo %s: %s",
            page_number,
            file_path,
            exc,
        )
        return None


def _extract_pdf_pages(file_path: Path):
    extracted_pages: list[str] = []
    ocr_used = False
    ocr_required = False

    with pdfplumber.open(file_path) as pdf_document:
        page_count = len(pdf_document.pages)
        for page_number, page in enumerate(pdf_document.pages, start=1):
            native_text = (page.extract_text() or "").strip()
            if native_text:
                extracted_pages.append(native_text)
                continue

            ocr_text = _ocr_extract_page_text(file_path, page_number)
            if ocr_text:
                extracted_pages.append(ocr_text)
                ocr_used = True
                continue

            extracted_pages.append("")
            ocr_required = True

    extracted_text = "\n\n".join(extracted_pages).strip()
    if extracted_text and ocr_used:
        extraction_status = "ocr"
    elif extracted_text:
        extraction_status = "texto_nativo"
    else:
        extraction_status = "necessita_ocr"
        ocr_required = True

    return {
        "page_count": page_count,
        "pages": extracted_pages,
        "text": extracted_text,
        "ocr_used": ocr_used,
        "ocr_required": ocr_required,
        "extraction_status": extraction_status,
    }


def process_uploaded_pdf(upload_id: str, stored_filename: str, uploader_email: str | None = None):
    file_path = UPLOADS_DIR / stored_filename
    temp_text_path = TEMP_TEXT_DIR / f"{upload_id}.txt"
    document_title = Path(stored_filename).name.split("_", 1)[-1].rsplit(".", 1)[0]
    db_helper.update_upload_status(upload_id, "processando")

    try:
        if not file_path.exists():
            raise FileNotFoundError(f"Arquivo não encontrado para processamento: {stored_filename}")

        extraction = _extract_pdf_pages(file_path)
        extracted_pages = extraction["pages"]
        page_count = extraction["page_count"]
        extracted_text = extraction["text"]
        ocr_required = extraction["ocr_required"]
        extraction_status = extraction["extraction_status"]

        if extracted_text:
            temp_text_path.write_text(extracted_text, encoding="utf-8")

            split_strategy, tracks = _split_text_into_tracks(extracted_pages, document_title)
            total_tracks = len(tracks)

            db_helper.update_upload_status(
                upload_id,
                "processando",
                {
                    "conversion_total_tracks": total_tracks,
                    "conversion_generated_tracks": 0,
                    "conversion_progress_percent": 0,
                    "track_count": 0,
                },
            )

            def on_track_generated(generated_count: int, all_tracks: int, generated_items: list[dict]):
                progress_percent = 100 if all_tracks <= 0 else round((generated_count / all_tracks) * 100)
                db_helper.update_upload_status(
                    upload_id,
                    "processando",
                    {
                        "conversion_total_tracks": all_tracks,
                        "conversion_generated_tracks": generated_count,
                        "conversion_progress_percent": progress_percent,
                        "track_count": generated_count,
                        "tracks": generated_items,
                    },
                )

            generated_tracks = _generate_audio_tracks(upload_id, tracks, on_track_generated)
            title = document_title

            db_helper.upsert_audiobook_from_upload(
                upload_id=upload_id,
                title=title,
                original_pdf=stored_filename,
                status="pronto",
                tracks=generated_tracks,
            )

            if uploader_email:
                granted = db_helper.set_upload_permission(upload_id, uploader_email, active=True)
                if not granted:
                    processing_logger.warning(
                        "Nao foi possivel conceder permissao automatica para upload_id=%s usuario=%s",
                        upload_id,
                        uploader_email,
                    )

            db_helper.update_upload_status(
                upload_id,
                "pronto",
                {
                    "error_log": None,
                    "page_count": page_count,
                    "processed_at": datetime.now(timezone.utc),
                    "extraction_status": extraction_status,
                    "ocr_required": ocr_required,
                    "temp_text_path": str(temp_text_path),
                    "extracted_characters": len(extracted_text),
                    "split_strategy": split_strategy,
                    "audio_format": AUDIO_OUTPUT_FORMAT,
                    "tracks": generated_tracks,
                    "track_count": len(generated_tracks),
                    "conversion_total_tracks": len(generated_tracks),
                    "conversion_generated_tracks": len(generated_tracks),
                    "conversion_progress_percent": 100,
                    "total_duration_seconds": round(
                        sum(item.get("duration_seconds", 0) for item in generated_tracks), 2
                    ),
                },
            )
        else:
            temp_text_path.unlink(missing_ok=True)
            title = document_title
            db_helper.upsert_audiobook_from_upload(
                upload_id=upload_id,
                title=title,
                original_pdf=stored_filename,
                status="necessita_ocr",
                tracks=[],
            )
            db_helper.update_upload_status(
                upload_id,
                "necessita_ocr",
                {
                    "error_log": "PDF escaneado sem texto nativo. Necessita OCR.",
                    "page_count": page_count,
                    "processed_at": datetime.now(timezone.utc),
                    "extraction_status": extraction_status,
                    "ocr_required": True,
                    "temp_text_path": None,
                    "extracted_characters": 0,
                    "split_strategy": None,
                    "audio_format": None,
                    "tracks": [],
                    "track_count": 0,
                    "conversion_total_tracks": 0,
                    "conversion_generated_tracks": 0,
                    "conversion_progress_percent": 0,
                    "total_duration_seconds": 0,
                },
            )
    except Exception as exc:
        temp_text_path.unlink(missing_ok=True)
        title = document_title
        db_helper.upsert_audiobook_from_upload(
            upload_id=upload_id,
            title=title,
            original_pdf=stored_filename,
            status="falhou",
            tracks=[],
        )
        error_message = str(exc)
        processing_logger.exception(
            "Falha no processamento do upload_id=%s arquivo=%s erro=%s",
            upload_id,
            stored_filename,
            error_message,
        )
        db_helper.update_upload_status(
            upload_id,
            "falhou",
            {
                "error_log": error_message,
                "processed_at": datetime.now(timezone.utc),
                "extraction_status": "falhou",
                "ocr_required": None,
                "temp_text_path": None,
                "tracks": [],
                "conversion_progress_percent": 0,
            },
        )


def _split_text_into_tracks(page_texts: list[str], document_title: str):
    return "por_pagina", _split_by_pages(page_texts, document_title)


def _split_by_detected_chapters(extracted_text: str):
    matches = list(CHAPTER_PATTERN.finditer(extracted_text))
    if not matches:
        return []

    tracks = []
    for index, match in enumerate(matches):
        start = match.start()
        end = matches[index + 1].start() if index + 1 < len(matches) else len(extracted_text)
        content = extracted_text[start:end].strip()
        if not content:
            continue

        title = match.group(0).strip()[:80]
        tracks.append(
            {
                "name": title,
                "order": len(tracks) + 1,
                "text": content,
            }
        )

    return tracks


def _split_by_pages(page_texts: list[str], document_title: str):
    total_pages = len(page_texts)
    if total_pages == 0:
        return []

    tracks = []
    for page_number, page_text in enumerate(page_texts, 1):
        text = (page_text or "").strip()
        display_title = f"{document_title} - faixa ({page_number}/{total_pages})"
        tracks.append(
            {
                "name": display_title,
                "order": page_number,
                "text": text,
            }
        )

    return tracks


def _estimate_duration_seconds(text: str):
    words = len(re.findall(r"\S+", text))
    words_per_second = max(WORDS_PER_SECOND, 0.1)
    return max(1.0, words / words_per_second)


def _slugify_filename(value: str):
    cleaned = re.sub(r"[^a-zA-Z0-9_-]+", "-", value).strip("-")
    return cleaned.lower() or "faixa"


def _write_silent_wav(path: Path, duration_seconds: float):
    sample_rate = 22050
    total_samples = int(sample_rate * duration_seconds)
    silence_frame = (0).to_bytes(2, byteorder="little", signed=True)

    with wave.open(str(path), "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(sample_rate)

        chunk_size = 4096
        remaining = total_samples
        while remaining > 0:
            samples_to_write = min(chunk_size, remaining)
            wav_file.writeframes(silence_frame * samples_to_write)
            remaining -= samples_to_write


def _load_piper_voice():
    global _piper_voice
    if _piper_voice is not None:
        return _piper_voice

    if not PIPER_MODEL_PATH.exists():
        raise RuntimeError(f"Modelo Piper não encontrado: {PIPER_MODEL_PATH}")

    if not PIPER_CONFIG_PATH.exists():
        raise RuntimeError(f"Configuração Piper não encontrada: {PIPER_CONFIG_PATH}")

    from piper.voice import PiperVoice

    _piper_voice = PiperVoice.load(
        str(PIPER_MODEL_PATH),
        config_path=str(PIPER_CONFIG_PATH),
    )
    return _piper_voice


def _write_tts_wav(path: Path, text: str):
    voice = _load_piper_voice()
    with wave.open(str(path), "wb") as wav_file:
        voice.synthesize_wav(text, wav_file)


def _get_wav_duration_seconds(path: Path):
    with wave.open(str(path), "rb") as wav_file:
        frame_rate = wav_file.getframerate()
        total_frames = wav_file.getnframes()
        if frame_rate <= 0:
            return 0.0
        return total_frames / float(frame_rate)


def _try_convert_wav_to_mp3(wav_path: Path, mp3_path: Path):
    try:
        from pydub import AudioSegment

        audio_segment = AudioSegment.from_wav(str(wav_path))
        audio_segment.export(str(mp3_path), format="mp3")
        return True
    except Exception:
        return False


def _generate_audio_tracks(
    upload_id: str,
    tracks: list[dict],
    on_track_generated: Callable[[int, int, list[dict]], None] | None = None,
):
    if not tracks:
        raise RuntimeError("Não foi possível dividir o PDF em faixas.")

    generated_tracks = []
    total_tracks = len(tracks)

    for track in tracks:
        order = int(track.get("order", len(generated_tracks) + 1))
        name = track.get("name") or f"Faixa {order:02d}"
        text = track.get("text", "")

        estimated_duration = _estimate_duration_seconds(text)
        file_basename = f"{upload_id}_faixa_{order:02d}_{_slugify_filename(name)}"

        preferred_format = AUDIO_OUTPUT_FORMAT if AUDIO_OUTPUT_FORMAT in {"wav", "mp3"} else "wav"
        wav_path = AUDIOS_DIR / f"{file_basename}.wav"
        if text and text.strip():
            try:
                _write_tts_wav(wav_path, text)
            except Exception as exc:
                processing_logger.warning(
                    "Falha ao sintetizar TTS com Piper para upload_id=%s faixa=%s: %s. Gerando silencio.",
                    upload_id,
                    name,
                    exc,
                )
                _write_silent_wav(wav_path, estimated_duration)
        else:
            _write_silent_wav(wav_path, estimated_duration)

        real_duration = _get_wav_duration_seconds(wav_path)

        output_format = "wav"
        output_path = wav_path

        if preferred_format == "mp3":
            mp3_path = AUDIOS_DIR / f"{file_basename}.mp3"
            if _try_convert_wav_to_mp3(wav_path, mp3_path):
                output_format = "mp3"
                output_path = mp3_path
                wav_path.unlink(missing_ok=True)
            else:
                processing_logger.warning(
                    "Conversão para MP3 indisponível para upload_id=%s faixa=%s. Mantido WAV.",
                    upload_id,
                    name,
                )

        generated_tracks.append(
            {
                "name": name,
                "order": order,
                "duration_seconds": round(real_duration or estimated_duration, 2),
                "format": output_format,
                "file_name": output_path.name,
                "file_path": str(output_path),
            }
        )

        if on_track_generated:
            on_track_generated(len(generated_tracks), total_tracks, list(generated_tracks))

    return generated_tracks


@app.get("/admin/uploads")
def list_uploads_status(current_user=Depends(require_roles("Admin", allow_admin_override=False))):
    uploads = db_helper.list_upload_records()
    return {
        "uploads": uploads,
        "possible_status": ["enviado", "processando", "pronto", "necessita_ocr", "falhou"],
    }


@app.delete("/admin/audiobooks/{audiobook_id}")
def delete_audiobook(
    audiobook_id: str,
    cascade: bool | None = None,
    current_user=Depends(require_roles("Admin", allow_admin_override=False)),
):
    deleted, reason = db_helper.delete_audiobook(audiobook_id=audiobook_id, cascade=cascade)
    if not deleted:
        if reason == "related_records_exist":
            raise HTTPException(
                status_code=409,
                detail="Existem Tracks/Permissions vinculados. Ative cascata para excluir.",
            )
        raise HTTPException(status_code=404, detail="Audiobook não encontrado.")

    return {
        "message": "Audiobook removido com sucesso.",
        "audiobook_id": audiobook_id,
        "cascade": cascade,
    }


@app.post("/admin/uploads")
def upload_pdfs(
    background_tasks: BackgroundTasks,
    files: list[UploadFile] = File(...),
    current_user=Depends(require_roles("Admin", allow_admin_override=False)),
):
    if not files:
        raise HTTPException(status_code=400, detail="Nenhum arquivo foi enviado.")

    saved_files = []
    records_to_create = []

    try:
        for file in files:
            original_name = file.filename or "arquivo.pdf"
            lower_name = original_name.lower()

            if not lower_name.endswith(".pdf"):
                raise HTTPException(
                    status_code=400,
                    detail=f"Arquivo inválido: {original_name}. Apenas .pdf é permitido.",
                )

            unique_name = f"{uuid.uuid4().hex}_{Path(original_name).name}"
            output_path = UPLOADS_DIR / unique_name

            bytes_written = 0
            with output_path.open("wb") as destination:
                while True:
                    chunk = file.file.read(1024 * 1024)
                    if not chunk:
                        break

                    bytes_written += len(chunk)
                    if bytes_written > MAX_UPLOAD_SIZE_BYTES:
                        destination.close()
                        output_path.unlink(missing_ok=True)
                        raise HTTPException(
                            status_code=400,
                            detail=(
                                f"Arquivo excede o tamanho máximo de {MAX_UPLOAD_SIZE_MB}MB: "
                                f"{original_name}"
                            ),
                        )

                    destination.write(chunk)

            saved_files.append(output_path)
            records_to_create.append(
                {
                    "filename": Path(original_name).name,
                    "stored_filename": unique_name,
                    "file_size_bytes": bytes_written,
                    "content_type": file.content_type,
                    "uploaded_by": current_user.get("email"),
                    "status": "enviado",
                }
            )

        inserted_ids = db_helper.create_upload_records(records_to_create)
        if len(inserted_ids) != len(records_to_create):
            raise HTTPException(status_code=500, detail="Falha ao criar registros de upload.")

        uploads_response = []
        for index, record in enumerate(records_to_create):
            upload_id = inserted_ids[index]
            uploads_response.append(
                {
                    "id": upload_id,
                    "filename": record["filename"],
                    "stored_filename": record["stored_filename"],
                    "file_size_bytes": record["file_size_bytes"],
                    "status": record["status"],
                }
            )

            background_tasks.add_task(
                process_uploaded_pdf,
                upload_id,
                record["stored_filename"],
                current_user.get("email"),
            )

        return {
            "message": "Upload concluído com sucesso.",
            "uploaded_count": len(uploads_response),
            "max_size_mb": MAX_UPLOAD_SIZE_MB,
            "uploads": uploads_response,
        }
    except HTTPException:
        # Evita arquivos órfãos quando alguma validação falha no lote.
        for saved_file in saved_files:
            saved_file.unlink(missing_ok=True)
        raise
    except Exception as exc:
        for saved_file in saved_files:
            saved_file.unlink(missing_ok=True)
        raise HTTPException(status_code=500, detail=f"Erro ao processar upload: {exc}") from exc
    finally:
        for file in files:
            if file.file:
                file.file.close()