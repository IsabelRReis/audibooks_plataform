const ADMIN_API_BASE_URL = (window.APP_CONFIG && window.APP_CONFIG.API_BASE_URL) || "http://127.0.0.1:8000";
const STATUS_REFRESH_INTERVAL_MS = 4000;

let latestUploads = [];
let latestUsers = [];

function isUserAdmin(user) {
    const profile = String(user?.profile || "").toLowerCase();
    const role = String(user?.role || "").toLowerCase();
    return profile === "admin" || role === "admin";
}

function isRecentUser(createdAt) {
    if (!createdAt) {
        return false;
    }
    const createdDate = new Date(createdAt);
    if (Number.isNaN(createdDate.getTime())) {
        return false;
    }
    const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
    return createdDate.getTime() >= sevenDaysAgo;
}

function renderUsersDashboard(users) {
    const feedback = document.getElementById("users-dashboard-feedback");
    const totalCountElement = document.getElementById("users-total-count");
    const adminCountElement = document.getElementById("users-admin-count");
    const standardCountElement = document.getElementById("users-standard-count");
    const recentCountElement = document.getElementById("users-recent-count");
    const tableBody = document.getElementById("users-table-body");

    if (!tableBody) {
        return;
    }

    const admins = users.filter((user) => isUserAdmin(user));
    const standards = users.filter((user) => !isUserAdmin(user));
    const recentUsers = users.filter((user) => isRecentUser(user.created_at));

    if (totalCountElement) {
        totalCountElement.textContent = String(users.length);
    }
    if (adminCountElement) {
        adminCountElement.textContent = String(admins.length);
    }
    if (standardCountElement) {
        standardCountElement.textContent = String(standards.length);
    }
    if (recentCountElement) {
        recentCountElement.textContent = String(recentUsers.length);
    }

    if (feedback) {
        feedback.textContent = users.length
            ? `${users.length} usuário(s) carregado(s) com sucesso.`
            : "Nenhum usuário cadastrado ainda.";
    }

    tableBody.innerHTML = "";

    if (!users.length) {
        const tr = document.createElement("tr");
        tr.innerHTML = '<td colspan="2" class="users-empty-state">Nenhum usuário cadastrado.</td>';
        tableBody.appendChild(tr);
        return;
    }

    const uploadsByEmail = latestUploads.reduce((acc, upload) => {
        const email = String(upload?.uploaded_by || "").trim().toLowerCase();
        if (!email) {
            return acc;
        }
        acc[email] = (acc[email] || 0) + 1;
        return acc;
    }, {});

    const usersSorted = [...users].sort((a, b) => {
        const emailA = String(a.email || "").toLowerCase();
        const emailB = String(b.email || "").toLowerCase();
        return emailA.localeCompare(emailB);
    });

    for (const user of usersSorted) {
        const tr = document.createElement("tr");
        const normalizedEmail = String(user.email || "").trim().toLowerCase();
        const totalUploads = uploadsByEmail[normalizedEmail] || 0;
        tr.innerHTML = `
            <td>${user.email || "-"}</td>
            <td>${totalUploads}</td>
        `;
        tableBody.appendChild(tr);
    }
}

function updateAdminInsights() {
    const activeUsersElement = document.getElementById("metric-active-users");
    const queueConversionsElement = document.getElementById("metric-queue-conversions");
    const completedProcessesElement = document.getElementById("metric-completed-processes");

    const activeUsers = latestUsers.filter((user) => String(user.profile || "").toLowerCase() !== "admin").length;
    const queuedConversions = latestUploads.filter((upload) => {
        const status = String(upload.status || "").toLowerCase();
        return status === "enviado" || status === "processando";
    }).length;
    const completedProcesses = latestUploads.filter(
        (upload) => String(upload.status || "").toLowerCase() === "pronto",
    ).length;

    if (activeUsersElement) {
        activeUsersElement.textContent = String(activeUsers);
    }

    if (queueConversionsElement) {
        queueConversionsElement.textContent = String(queuedConversions);
    }

    if (completedProcessesElement) {
        completedProcessesElement.textContent = String(completedProcesses);
    }
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

function setPermissionFeedback(message, isSuccess = false) {
    const feedback = document.getElementById("permission-feedback");
    if (!feedback) {
        return;
    }

    feedback.textContent = message;
    feedback.classList.toggle("success", isSuccess);
    feedback.classList.toggle("danger", !isSuccess && Boolean(message));
}

function renderResultList(uploads) {
    const list = document.getElementById("upload-result-list");
    if (!list) {
        return;
    }

    list.innerHTML = "";

    for (const item of uploads) {
        const li = document.createElement("li");
        const sizeInMb = (item.file_size_bytes / (1024 * 1024)).toFixed(2);
        li.textContent = `${item.filename} - ${sizeInMb} MB - status: ${item.status}`;
        list.appendChild(li);
    }
}

function formatDate(value) {
    if (!value) {
        return "-";
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return "-";
    }
    return date.toLocaleString("pt-BR");
}

function mapStatusLabel(status) {
    const normalized = String(status || "").toLowerCase();
    if (normalized === "enviado") {
        return "Enviado";
    }
    if (normalized === "processando") {
        return "Processando";
    }
    if (normalized === "pronto") {
        return "Pronto";
    }
    if (normalized === "necessita_ocr") {
        return "Necessita OCR";
    }
    if (normalized === "falhou") {
        return "Falhou";
    }
    return status || "-";
}

function mapStatusClass(status) {
    const normalized = String(status || "").toLowerCase();
    if (normalized === "enviado") {
        return "status-enviado";
    }
    if (normalized === "processando") {
        return "status-processando";
    }
    if (normalized === "pronto") {
        return "status-pronto";
    }
    if (normalized === "necessita_ocr") {
        return "status-necessita-ocr";
    }
    return "status-falhou";
}

function renderStatusTable(uploads) {
    const tableBody = document.getElementById("status-table-body");
    if (!tableBody) {
        return;
    }

    tableBody.innerHTML = "";

    if (!uploads.length) {
        const tr = document.createElement("tr");
        tr.innerHTML = `<td colspan="6">Nenhum upload registrado ainda.</td>`;
        tableBody.appendChild(tr);
        return;
    }

    for (const item of uploads) {
        const tr = document.createElement("tr");
        const statusLabel = mapStatusLabel(item.status);
        const statusClass = mapStatusClass(item.status);
        const tracks = Array.isArray(item.tracks) ? item.tracks : [];
        const tracksText = tracks.length
            ? tracks
                .map((track) => {
                    const order = track.order ?? "-";
                    const duration = track.duration_seconds ?? 0;
                    const name = track.name || "Faixa";
                    return `${order}. ${name} (${duration}s)`;
                })
                .join(" | ")
            : "-";

        tr.innerHTML = `
            <td>${item.filename || "-"}</td>
            <td><span class="status-badge ${statusClass}">${statusLabel}</span></td>
            <td>${tracksText}</td>
            <td>${item.page_count ?? "-"}</td>
            <td>${formatDate(item.updated_at || item.created_at)}</td>
            <td>${item.error_log || "-"}</td>
        `;
        tableBody.appendChild(tr);
    }
}

function renderUploadSelectOptions(uploads) {
    const select = document.getElementById("permission-upload-select");
    if (!select) {
        return;
    }

    const readyUploads = uploads.filter((item) => String(item.status || "").toLowerCase() === "pronto");

    select.innerHTML = '<option value="">Selecione um audiobook</option>';
    for (const upload of readyUploads) {
        const option = document.createElement("option");
        option.value = upload.id;
        option.textContent = `${upload.filename || "Sem título"} (${upload.track_count ?? 0} faixa(s))`;
        select.appendChild(option);
    }

    renderGrantedUsersList();
}

function getSelectedUpload() {
    const select = document.getElementById("permission-upload-select");
    const selectedId = select?.value;
    if (!selectedId) {
        return null;
    }
    return latestUploads.find((item) => item.id === selectedId) || null;
}

function renderGrantedUsersList() {
    const list = document.getElementById("granted-users-list");
    if (!list) {
        return;
    }

    list.innerHTML = "";

    const selectedUpload = getSelectedUpload();
    if (!selectedUpload) {
        list.innerHTML = "<li>Selecione um audiobook para visualizar acessos.</li>";
        return;
    }

    const permissions = Array.isArray(selectedUpload.permissions) ? selectedUpload.permissions : [];
    const activePermissions = permissions.filter((perm) => perm && perm.active);

    if (!activePermissions.length) {
        list.innerHTML = "<li>Nenhum usuário com acesso ativo.</li>";
        return;
    }

    for (const permission of activePermissions) {
        const li = document.createElement("li");
        const userEmail = permission.user_email || "-";
        li.innerHTML = `
            <span>${userEmail}</span>
            <button type="button" class="revoke-btn" data-upload-id="${selectedUpload.id}" data-user-email="${userEmail}">
                Revogar
            </button>
        `;
        list.appendChild(li);
    }
}

function renderUsersList(users) {
    const usersList = document.getElementById("permission-users-list");
    if (!usersList) {
        return;
    }

    usersList.innerHTML = "";

    const filteredUsers = users.filter((user) => (user.profile || "").toLowerCase() !== "admin");
    if (!filteredUsers.length) {
        usersList.innerHTML = '<p class="text-muted">Nenhum usuário disponível para concessão.</p>';
        return;
    }

    for (const user of filteredUsers) {
        const wrapper = document.createElement("label");
        wrapper.className = "permission-user-item";
        wrapper.innerHTML = `
            <input type="checkbox" name="permission-user-email" value="${user.email}">
            <span>${user.name || user.email}</span>
            <small>(${user.email})</small>
        `;
        usersList.appendChild(wrapper);
    }
}

async function fetchUsersList() {
    const session = window.AppSession.getStoredSession();
    if (!session.token) {
        return;
    }

    try {
        const response = await fetch(`${ADMIN_API_BASE_URL}/admin/users`, {
            method: "GET",
            headers: {
                Authorization: `Bearer ${session.token}`,
            },
        });

        const data = await response.json();
        if (!response.ok) {
            if (response.status === 401) {
                window.AppSession.logout();
            }
            return;
        }

        latestUsers = data.users || [];
        renderUsersDashboard(latestUsers);
        renderUsersList(latestUsers);
        updateAdminInsights();
    } catch (error) {
        // Falha de rede transitória ao carregar usuários.
    }
}

async function fetchUploadStatusList() {
    const session = window.AppSession.getStoredSession();
    if (!session.token) {
        return;
    }

    try {
        const response = await fetch(`${ADMIN_API_BASE_URL}/admin/uploads`, {
            method: "GET",
            headers: {
                Authorization: `Bearer ${session.token}`,
            },
        });

        const data = await response.json();

        if (!response.ok) {
            if (response.status === 401) {
                window.AppSession.logout();
                return;
            }
            return;
        }

        latestUploads = data.uploads || [];
        renderStatusTable(latestUploads);
        renderUploadSelectOptions(latestUploads);
        renderGrantedUsersList();
        renderUsersDashboard(latestUsers);
        updateAdminInsights();
    } catch (error) {
        // Ignora erro transitório de rede na atualização automática.
    }
}

async function revokeUserPermission(uploadId, userEmail) {
    const session = window.AppSession.getStoredSession();
    if (!session.token) {
        window.AppSession.logout();
        return;
    }

    try {
        const params = new URLSearchParams({
            upload_id: uploadId,
            user_email: userEmail,
        });
        const response = await fetch(`${ADMIN_API_BASE_URL}/admin/library/permissions?${params.toString()}`, {
            method: "DELETE",
            headers: {
                Authorization: `Bearer ${session.token}`,
            },
        });

        const data = await response.json();
        if (!response.ok) {
            if (response.status === 401) {
                window.AppSession.logout();
                return;
            }
            throw new Error(data.detail || "Falha ao revogar acesso.");
        }

        setPermissionFeedback(`Acesso revogado para ${userEmail}.`, true);
        await fetchUploadStatusList();
    } catch (error) {
        setPermissionFeedback(error.message || "Não foi possível revogar o acesso.");
    }
}

function hasOnlyPdf(files) {
    return files.every((file) => file.name.toLowerCase().endsWith(".pdf"));
}

function uploadFilesWithProgress(files, token) {
    return new Promise((resolve, reject) => {
        const formData = new FormData();
        for (const file of files) {
            formData.append("files", file);
        }

        const request = new XMLHttpRequest();
        request.open("POST", `${ADMIN_API_BASE_URL}/admin/uploads`);
        request.setRequestHeader("Authorization", `Bearer ${token}`);

        request.upload.addEventListener("progress", (event) => {
            if (event.lengthComputable) {
                const percent = Math.round((event.loaded / event.total) * 100);
                updateProgress(percent);
            }
        });

        request.addEventListener("load", () => {
            try {
                const data = JSON.parse(request.responseText || "{}");
                if (request.status >= 200 && request.status < 300) {
                    resolve(data);
                    return;
                }
                reject(new Error(data.detail || "Erro ao realizar upload."));
            } catch (error) {
                reject(new Error("Resposta invalida do servidor."));
            }
        });

        request.addEventListener("error", () => {
            reject(new Error("Falha de conexao durante o upload."));
        });

        request.send(formData);
    });
}

async function handleUploadSubmit(event) {
    event.preventDefault();

    const session = window.AppSession.getStoredSession();
    if (!session.token) {
        window.AppSession.logout();
        return;
    }

    const input = document.getElementById("upload-input");
    const files = Array.from(input?.files || []);

    if (!files.length) {
        setFeedback("Selecione ao menos um PDF para envio.");
        return;
    }

    if (!hasOnlyPdf(files)) {
        setFeedback("Apenas arquivos .pdf sao permitidos.");
        return;
    }

    setFeedback("Enviando arquivos...");
    renderResultList([]);
    updateProgress(0);

    try {
        const result = await uploadFilesWithProgress(files, session.token);
        updateProgress(100);
        setFeedback(`${result.uploaded_count} arquivo(s) enviado(s) com sucesso.`, true);
        renderResultList(result.uploads || []);
        await fetchUploadStatusList();
        if (input) {
            input.value = "";
        }
    } catch (error) {
        updateProgress(0);
        setFeedback(error.message || "Nao foi possivel completar o upload.");
    }
}

function getSelectedUserEmails() {
    const checkboxes = document.querySelectorAll('input[name="permission-user-email"]:checked');
    return Array.from(checkboxes).map((checkbox) => checkbox.value);
}

async function handlePermissionSubmit(event) {
    event.preventDefault();

    const session = window.AppSession.getStoredSession();
    if (!session.token) {
        window.AppSession.logout();
        return;
    }

    const uploadSelect = document.getElementById("permission-upload-select");
    const uploadId = uploadSelect?.value;
    const selectedUsers = getSelectedUserEmails();

    if (!uploadId) {
        setPermissionFeedback("Selecione um audiobook para liberar acesso.");
        return;
    }

    if (!selectedUsers.length) {
        setPermissionFeedback("Selecione ao menos um usuário.");
        return;
    }

    setPermissionFeedback("Aplicando permissões...");

    try {
        const response = await fetch(`${ADMIN_API_BASE_URL}/admin/library/permissions/bulk`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${session.token}`,
            },
            body: JSON.stringify({
                upload_id: uploadId,
                user_emails: selectedUsers,
                active: true,
            }),
        });

        const data = await response.json();
        if (!response.ok) {
            if (response.status === 401) {
                window.AppSession.logout();
                return;
            }
            throw new Error(data.detail || "Falha ao conceder permissões.");
        }

        setPermissionFeedback(
            `Acesso liberado para ${data.updated_count} usuário(s). Atualização disponível imediatamente.`,
            true,
        );
    } catch (error) {
        setPermissionFeedback(error.message || "Não foi possível atualizar permissões.");
    }
}

function handleSelectAllUsers() {
    const checkboxes = document.querySelectorAll('input[name="permission-user-email"]');
    if (!checkboxes.length) {
        return;
    }

    const allChecked = Array.from(checkboxes).every((checkbox) => checkbox.checked);
    for (const checkbox of checkboxes) {
        checkbox.checked = !allChecked;
    }
}

function handleUploadSelectionChange() {
    renderGrantedUsersList();
}

function handleGrantedUsersClick(event) {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
        return;
    }

    if (!target.classList.contains("revoke-btn")) {
        return;
    }

    const uploadId = target.getAttribute("data-upload-id");
    const userEmail = target.getAttribute("data-user-email");
    if (!uploadId || !userEmail) {
        return;
    }

    revokeUserPermission(uploadId, userEmail);
}

const uploadForm = document.getElementById("upload-form");
if (uploadForm) {
    uploadForm.addEventListener("submit", handleUploadSubmit);
}

const permissionForm = document.getElementById("permission-form");
if (permissionForm) {
    permissionForm.addEventListener("submit", handlePermissionSubmit);
}

const uploadSelect = document.getElementById("permission-upload-select");
if (uploadSelect) {
    uploadSelect.addEventListener("change", handleUploadSelectionChange);
}

const selectAllUsersButton = document.getElementById("select-all-users-btn");
if (selectAllUsersButton) {
    selectAllUsersButton.addEventListener("click", handleSelectAllUsers);
}

const grantedUsersList = document.getElementById("granted-users-list");
if (grantedUsersList) {
    grantedUsersList.addEventListener("click", handleGrantedUsersClick);
}

fetchUploadStatusList();
fetchUsersList();
window.setInterval(fetchUploadStatusList, STATUS_REFRESH_INTERVAL_MS);
window.setInterval(fetchUsersList, STATUS_REFRESH_INTERVAL_MS * 3);
