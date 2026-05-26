const API_BASE_URL = (window.APP_CONFIG && window.APP_CONFIG.API_BASE_URL) || "http://127.0.0.1:8000";
const UPLOADS_REFRESH_INTERVAL_MS = 3000;
const UPLOADS_ERROR_TOAST_COOLDOWN_MS = 15000;

let userUploads = [];
let refreshInterval = null;
let uploadsErrorToastAt = 0;
let hadUploadsFetchError = false;
const expandedTracksByUploadId = new Set();

function ensureToastContainer() {
    let container = document.getElementById("toast-container");
    if (!container) {
        container = document.createElement("div");
        container.id = "toast-container";
        document.body.appendChild(container);
    }
    return container;
}

function showToast(message, type = "info") {
    const container = ensureToastContainer();
    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    window.setTimeout(() => {
        toast.classList.add("toast-hide");
        window.setTimeout(() => toast.remove(), 240);
    }, 2800);
}

function getAuthToken() {
    return sessionStorage.getItem("authToken") || "";
}

function createAuthHeaders() {
    return {
        "Authorization": `Bearer ${getAuthToken()}`,
        "Content-Type": "application/json"
    };
}

function updateProgress(percent) {
    const progressBar = document.getElementById("upload-progress-bar");
    if (!progressBar) {
        return;
    }
    progressBar.style.width = `${percent}%`;
}

function setFeedback(message, isSuccess = false) {
    const feedback = document.getElementById("upload-feedback");
    if (!feedback) {
        return;
    }

    feedback.textContent = message;
    feedback.classList.toggle("success", isSuccess);
    feedback.classList.toggle("danger", !isSuccess && Boolean(message));
}

function formatFileSize(bytes) {
    if (!bytes) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i];
}

function formatDate(value) {
    if (!value) return "-";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "-";
    return date.toLocaleString("pt-BR");
}

function mapStatusLabel(status) {
    const normalized = String(status || "").toLowerCase();
    const statusMap = {
        "enviado": "Enviado",
        "processando": "Processando",
        "pronto": "Pronto",
        "necessita_ocr": "Necessita OCR",
        "falhou": "Falhou"
    };
    return statusMap[normalized] || status || "-";
}

function mapStatusClass(status) {
    const normalized = String(status || "").toLowerCase();
    const classMap = {
        "enviado": "status-enviado",
        "processando": "status-processando",
        "pronto": "status-pronto",
        "necessita_ocr": "status-necessita-ocr",
        "falhou": "status-falhou"
    };
    return classMap[normalized] || "status-falhou";
}

function getConversionProgress(upload) {
    const status = String(upload.status || "").toLowerCase();
    const total = Number(upload.conversion_total_tracks || 0);
    const generated = Number(upload.conversion_generated_tracks || 0);
    const persistedPercent = Number(upload.conversion_progress_percent || 0);

    if (status === "pronto") {
        return {
            percent: 100,
            generated: Math.max(generated, total, Number(upload.track_count || 0)),
            total: Math.max(total, Number(upload.track_count || 0)),
            label: "Concluido",
        };
    }

    if (status === "necessita_ocr") {
        return { percent: 0, generated: 0, total: 0, label: "Necessita OCR" };
    }

    if (status === "falhou") {
        return { percent: 0, generated, total, label: "Falhou" };
    }

    const safePercent = Math.max(0, Math.min(100, persistedPercent));
    return {
        percent: safePercent,
        generated,
        total,
        label: status === "processando" ? "Processando" : "Aguardando",
    };
}

async function fetchTracksByAudiobook(audiobookId) {
    const response = await fetch(`${API_BASE_URL}/library/audiobooks/${audiobookId}/tracks`, {
        method: "GET",
        headers: createAuthHeaders(),
    });

    const data = await response.json();
    if (!response.ok) {
        throw new Error(data.detail || "Nao foi possivel carregar as faixas.");
    }

    return data.tracks || [];
}

async function deleteTrack(trackId) {
    const response = await fetch(`${API_BASE_URL}/library/tracks/${trackId}`, {
        method: "DELETE",
        headers: createAuthHeaders(),
    });

    if (!response.ok) {
        const data = await response.json();
        throw new Error(data.detail || "Nao foi possivel remover a faixa.");
    }
}

async function deleteAudiobook(audiobookId) {
    const response = await fetch(`${API_BASE_URL}/library/audiobooks/${audiobookId}`, {
        method: "DELETE",
        headers: createAuthHeaders(),
    });

    if (!response.ok) {
        const data = await response.json();
        throw new Error(data.detail || "Nao foi possivel remover o audiobook.");
    }
}

function renderUploadsTable(uploads) {
    const tbody = document.getElementById("uploads-table-body");
    const summary = document.getElementById("uploads-summary");

    if (!tbody || !summary) {
        return;
    }

    if (!uploads.length) {
        tbody.innerHTML = `
            <tr>
                <td colspan="8" style="text-align: center; color: var(--color-info-dark); padding: 1.5rem;">
                    Nenhum upload realizado ainda. Comece enviando um PDF.
                </td>
            </tr>
        `;
        summary.textContent = "Nenhum upload realizado ainda.";
        return;
    }

    summary.textContent = `Existem ${uploads.length} upload(s) no total.`;

    tbody.innerHTML = uploads.map(upload => {
        const sizeFormatted = formatFileSize(upload.file_size_bytes);
        const dateFormatted = formatDate(upload.created_at);
        const statusLabel = mapStatusLabel(upload.status);
        const statusClass = mapStatusClass(upload.status);
        const trackCount = upload.track_count || 0;
        const errorMsg = upload.error_log || "-";
        const conversion = getConversionProgress(upload);
        const conversionMeta = conversion.total > 0
            ? `${conversion.generated}/${conversion.total} faixas`
            : conversion.label;
        const hasAudiobook = Boolean(upload.audiobook_id);
        const canManageReadyAudiobook = hasAudiobook && String(upload.status || "").toLowerCase() === "pronto";
        const isExpanded = expandedTracksByUploadId.has(upload.id);
        const actionsHtml = hasAudiobook
            ? `
                <div class="upload-actions-cell">
                    <button class="upload-action-btn upload-action-btn-secondary" data-action="toggle-tracks" data-upload-id="${upload.id}" data-audiobook-id="${upload.audiobook_id}">
                        ${isExpanded ? "Ocultar faixas" : "Ver faixas"}
                    </button>
                    ${canManageReadyAudiobook ? `
                    <button class="upload-action-btn upload-action-btn-danger" data-action="delete-audiobook" data-upload-id="${upload.id}" data-audiobook-id="${upload.audiobook_id}">
                        Excluir audiobook
                    </button>` : ""}
                    <div class="upload-tracks-panel" id="upload-tracks-${upload.id}" ${isExpanded ? "" : "hidden"}></div>
                </div>
            `
            : "-";

        return `
            <tr>
                <td><strong>${upload.filename || "N/A"}</strong></td>
                <td>
                    <span class="status-badge ${statusClass}">
                        ${statusLabel}
                    </span>
                </td>
                <td>${sizeFormatted}</td>
                <td><small>${dateFormatted}</small></td>
                <td>
                    <div class="conversion-progress-cell">
                        <div class="conversion-progress-track">
                            <div class="conversion-progress-fill" style="width: ${conversion.percent}%;"></div>
                        </div>
                        <small>${conversion.percent}% • ${conversionMeta}</small>
                    </div>
                </td>
                <td>${trackCount} faixa(s)</td>
                <td>${actionsHtml}</td>
                <td><small>${errorMsg}</small></td>
            </tr>
        `;
    }).join("");

    tbody.querySelectorAll("button[data-action='toggle-tracks']").forEach((button) => {
        button.addEventListener("click", async (event) => {
            event.preventDefault();
            const uploadId = event.currentTarget.dataset.uploadId;
            const audiobookId = event.currentTarget.dataset.audiobookId;
            const panel = document.getElementById(`upload-tracks-${uploadId}`);

            if (!panel || !audiobookId) {
                return;
            }

            if (!panel.hidden) {
                panel.hidden = true;
                expandedTracksByUploadId.delete(uploadId);
                event.currentTarget.textContent = "Ver faixas";
                return;
            }

            panel.hidden = false;
            expandedTracksByUploadId.add(uploadId);
            event.currentTarget.textContent = "Ocultar faixas";
            panel.innerHTML = "<p>Carregando faixas...</p>";

            try {
                const tracks = await fetchTracksByAudiobook(audiobookId);
                if (!tracks.length) {
                    panel.innerHTML = "<p>Nenhuma faixa encontrada.</p>";
                    return;
                }

                panel.innerHTML = tracks.map((track, index) => `
                    <div class="upload-track-row" data-track-id="${track.id}">
                        <div>
                            <strong>${track.order}. ${track.title}</strong>
                            <small class="text-muted">Página ${index + 1} de ${tracks.length}</small>
                        </div>
                        <button class="upload-action-btn upload-action-btn-danger" data-action="delete-track" data-track-id="${track.id}">Excluir faixa</button>
                    </div>
                `).join("");

                panel.querySelectorAll("button[data-action='delete-track']").forEach((trackDeleteButton) => {
                    trackDeleteButton.addEventListener("click", async (deleteEvent) => {
                        deleteEvent.preventDefault();
                        const trackId = deleteEvent.currentTarget.dataset.trackId;
                        const confirmed = window.confirm("Deseja realmente excluir esta faixa?");
                        if (!confirmed) {
                            return;
                        }

                        try {
                            await deleteTrack(trackId);
                            showToast("Faixa removida com sucesso.", "success");
                            await fetchUserUploads();
                        } catch (error) {
                            showToast(error.message || "Erro ao excluir faixa.", "error");
                        }
                    });
                });
            } catch (error) {
                panel.innerHTML = `<p>${error.message || "Erro ao carregar faixas."}</p>`;
            }
        });
    });

    tbody.querySelectorAll("button[data-action='delete-audiobook']").forEach((button) => {
        button.addEventListener("click", async (event) => {
            event.preventDefault();
            const audiobookId = event.currentTarget.dataset.audiobookId;
            if (!audiobookId) {
                return;
            }

            const confirmed = window.confirm("Deseja realmente excluir este audiobook pronto?");
            if (!confirmed) {
                return;
            }

            try {
                await deleteAudiobook(audiobookId);
                showToast("Audiobook removido com sucesso.", "success");
                await fetchUserUploads();
            } catch (error) {
                showToast(error.message || "Erro ao excluir audiobook.", "error");
            }
        });
    });
}

async function fetchUserUploads() {
    try {
        const token = getAuthToken();
        const response = await fetch(`${API_BASE_URL}/admin/uploads`, {
            method: "GET",
            headers: createAuthHeaders()
        });

        if (!response.ok) {
            console.warn(`Erro ao buscar uploads: ${response.status}`);
            const now = Date.now();
            if (now - uploadsErrorToastAt > UPLOADS_ERROR_TOAST_COOLDOWN_MS) {
                showToast("Nao foi possivel atualizar a lista de uploads agora.", "error");
                uploadsErrorToastAt = now;
            }
            hadUploadsFetchError = true;
            return [];
        }

        const data = await response.json();
        userUploads = Array.isArray(data) ? data : (Array.isArray(data.uploads) ? data.uploads : []);
        renderUploadsTable(userUploads);
        if (hadUploadsFetchError) {
            showToast("Lista de uploads atualizada novamente.", "success");
            hadUploadsFetchError = false;
        }
        return userUploads;
    } catch (error) {
        console.error("Erro ao buscar uploads:", error);
        const now = Date.now();
        if (now - uploadsErrorToastAt > UPLOADS_ERROR_TOAST_COOLDOWN_MS) {
            showToast("Erro de conexao ao buscar uploads.", "error");
            uploadsErrorToastAt = now;
        }
        hadUploadsFetchError = true;
        return [];
    }
}

async function handleUpload(event) {
    event.preventDefault();

    const fileInput = document.getElementById("upload-input");
    const progressContainer = document.getElementById("upload-progress-container");
    const resultContainer = document.getElementById("upload-result");

    let fileToUpload = null;

    // Se é um evento de drop, pegar arquivo do dataTransfer
    if (event.dataTransfer && event.dataTransfer.files.length > 0) {
        fileToUpload = event.dataTransfer.files[0];
    }
    // Senão, pegar do input
    else if (fileInput.files.length > 0) {
        fileToUpload = fileInput.files[0];
    }

    if (!fileToUpload) {
        setFeedback("Selecione um arquivo PDF.", false);
        showToast("Selecione um arquivo PDF para enviar.", "info");
        return;
    }

    if (!fileToUpload.type.includes("pdf") && !fileToUpload.name.endsWith(".pdf")) {
        setFeedback("Apenas arquivos PDF são aceitos.", false);
        showToast("Apenas arquivos PDF sao aceitos.", "error");
        return;
    }

    // Validar tamanho máximo (25 MB)
    const maxSizeMB = 25;
    const maxSizeBytes = maxSizeMB * 1024 * 1024;
    if (fileToUpload.size > maxSizeBytes) {
        setFeedback(`Arquivo muito grande. Máximo permitido: ${maxSizeMB} MB.`, false);
        showToast(`Arquivo excede ${maxSizeMB} MB.`, "error");
        return;
    }

    // Desabilitar área e mostrar progresso
    const dropZone = document.getElementById("upload-drop-zone");
    if (dropZone) {
        dropZone.style.pointerEvents = "none";
        dropZone.style.opacity = "0.6";
    }
    
    progressContainer.style.display = "block";
    setFeedback("Enviando arquivo...", false);
    resultContainer.style.display = "none";
    updateProgress(0);

    const formData = new FormData();
    formData.append("file", fileToUpload);

    try {
        const token = getAuthToken();
        const xhr = new XMLHttpRequest();

        // Rastrear progresso de upload
        xhr.upload.addEventListener("progress", (e) => {
            if (e.lengthComputable) {
                const percent = Math.round((e.loaded / e.total) * 100);
                updateProgress(percent);
            }
        });

        // Lidar com conclusão
        xhr.addEventListener("load", () => {
            if (xhr.status === 201 || xhr.status === 200) {
                const response = JSON.parse(xhr.responseText);
                setFeedback(`✓ Upload realizado com sucesso! Processamento iniciado.`, true);
                showToast("Upload enviado com sucesso. Processamento iniciado.", "success");

                const createdUpload = Array.isArray(response.uploads) ? response.uploads[0] : null;
                if (createdUpload) {
                    resultContainer.style.display = "block";
                    const resultList = document.getElementById("upload-result-list");
                    resultList.innerHTML = `
                        <li><strong>Arquivo:</strong> ${createdUpload.filename || "N/A"}</li>
                        <li><strong>Tamanho:</strong> ${formatFileSize(createdUpload.file_size_bytes)}</li>
                        <li><strong>Status:</strong> ${mapStatusLabel(createdUpload.status)}</li>
                        <li><strong>ID de Upload:</strong> <code>${createdUpload.id}</code></li>
                    `;
                }

                // Limpar input e resetar interface
                fileInput.value = "";
                updateProgress(0);

                // Atualizar tabela de uploads
                setTimeout(() => {
                    fetchUserUploads();
                }, 500);
            } else {
                const error = xhr.responseText ? JSON.parse(xhr.responseText) : {};
                setFeedback(`Erro: ${error.detail || "Falha ao enviar arquivo."}`, false);
                showToast(error.detail || "Falha ao enviar arquivo.", "error");
                updateProgress(0);
            }

            // Reabilitar área
            if (dropZone) {
                dropZone.style.pointerEvents = "auto";
                dropZone.style.opacity = "1";
            }
            progressContainer.style.display = "none";
        });

        // Lidar com erros
        xhr.addEventListener("error", () => {
            setFeedback("Erro de conexão. Verifique sua conexão com a internet.", false);
            showToast("Erro de conexao durante o upload.", "error");
            progressContainer.style.display = "none";
            updateProgress(0);
            if (dropZone) {
                dropZone.style.pointerEvents = "auto";
                dropZone.style.opacity = "1";
            }
        });

        xhr.open("POST", `${API_BASE_URL}/admin/uploads`);
        xhr.setRequestHeader("Authorization", `Bearer ${token}`);
        xhr.send(formData);
    } catch (error) {
        console.error("Erro ao enviar arquivo:", error);
        setFeedback("Erro ao preparar upload.", false);
        showToast("Erro ao preparar upload.", "error");
        progressContainer.style.display = "none";
        updateProgress(0);
        if (dropZone) {
            dropZone.style.pointerEvents = "auto";
            dropZone.style.opacity = "1";
        }
    }
}

// Inicialização
document.addEventListener("DOMContentLoaded", () => {
    const uploadForm = document.getElementById("upload-form");
    const uploadDropZone = document.getElementById("upload-drop-zone");
    const uploadInput = document.getElementById("upload-input");

    if (uploadForm) {
        uploadForm.addEventListener("submit", handleUpload);
    }

    // Clique na área de drop zone abre seletor de arquivo
    if (uploadDropZone && uploadInput) {
        uploadDropZone.addEventListener("click", () => {
            uploadInput.click();
        });

        // Quando arquivo é selecionado via clique, enviar automaticamente
        uploadInput.addEventListener("change", (event) => {
            const fakeEvent = { dataTransfer: { files: uploadInput.files }, preventDefault: () => {} };
            if (uploadInput.files.length > 0) {
                handleUpload(fakeEvent);
            }
        });

        // Drag and drop
        uploadDropZone.addEventListener("dragover", (e) => {
            e.preventDefault();
            e.stopPropagation();
            uploadDropZone.classList.add("dragover");
        });

        uploadDropZone.addEventListener("dragleave", (e) => {
            e.preventDefault();
            e.stopPropagation();
            uploadDropZone.classList.remove("dragover");
        });

        uploadDropZone.addEventListener("drop", (e) => {
            e.preventDefault();
            e.stopPropagation();
            uploadDropZone.classList.remove("dragover");

            const files = e.dataTransfer.files;
            if (files.length > 0) {
                const fakeEvent = { dataTransfer: { files: files }, preventDefault: () => {} };
                handleUpload(fakeEvent);
            }
        });
    }

    // Carregar uploads iniciais
    fetchUserUploads();

    // Atualizar tabela periodicamente
    refreshInterval = setInterval(() => {
        fetchUserUploads();
    }, UPLOADS_REFRESH_INTERVAL_MS);
});

// Limpar intervalo ao sair da página
window.addEventListener("beforeunload", () => {
    if (refreshInterval) {
        clearInterval(refreshInterval);
    }
});
