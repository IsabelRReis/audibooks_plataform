const USER_API_BASE_URL = (window.APP_CONFIG && window.APP_CONFIG.API_BASE_URL) || "http://127.0.0.1:8000";

function createAuthHeaders() {
    const session = window.AppSession.getStoredSession();
    return {
        Authorization: `Bearer ${session.token}`,
        "Content-Type": "application/json",
    };
}

async function loadUserSettings() {
    const emailInput = document.getElementById("settings-email");
    const nameInput = document.getElementById("settings-name");

    const session = window.AppSession.getStoredSession();
    if (!session || !session.token) {
        window.AppSession.logout();
        return;
    }

    // Fill known fields from sessionStorage
    if (emailInput) emailInput.value = session.email || "";

    const cachedName = sessionStorage.getItem("userName");
    if (cachedName && nameInput) {
        nameInput.value = cachedName;
    }

    // Try to validate session with backend and optionally fetch server-side profile (if available)
    try {
        const resp = await fetch(`${USER_API_BASE_URL}/auth/session/me`, {
            method: "GET",
            headers: createAuthHeaders(),
        });

        if (resp.ok) {
            const data = await resp.json();
            // server returns email/profile/expires_at only; name is not available in this API
            if (data.name) {
                if (nameInput) nameInput.value = data.name;
                sessionStorage.setItem("userName", data.name);
            }
        } else if (resp.status === 401) {
            window.AppSession.logout();
            return;
        }
    } catch (err) {
        // ignore network errors here; the form still works locally
    }
}

async function tryPersistProfileUpdate(payload) {
    // Try a PATCH to a conventional endpoint; backend may not support it.
    try {
        const resp = await fetch(`${USER_API_BASE_URL}/users/me`, {
            method: "PATCH",
            headers: createAuthHeaders(),
            body: JSON.stringify(payload),
        });
        return resp;
    } catch (err) {
        return null;
    }
}

function showFeedback(message, success = true) {
    const fb = document.getElementById("settings-feedback");
    if (!fb) return;
    fb.textContent = message;
    fb.classList.toggle("success", success);
}

document.addEventListener("DOMContentLoaded", () => {
    loadUserSettings();

    const form = document.getElementById("settings-form");
    if (!form) return;
    const profileNameEl = document.getElementById("profile-name");
    const profileEmailEl = document.getElementById("profile-email");
    const avatarInitials = document.getElementById("avatar-initials");

    function updateProfileCard(name, email) {
        if (profileNameEl && name) profileNameEl.textContent = name;
        if (profileEmailEl && email) profileEmailEl.textContent = email;
        if (avatarInitials) {
            const initials = (name || "").split(" ").filter(Boolean).map(s=>s[0].toUpperCase()).slice(0,2).join("") || (email||"").charAt(0).toUpperCase() || "?";
            avatarInitials.textContent = initials;
        }
    }

    // set initial card from session
    const sess = window.AppSession.getStoredSession();
    updateProfileCard(sess.profile === "Usuário" ? (sessionStorage.getItem("userName") || "Usuário") : (sessionStorage.getItem("userName") || "Usuário"), sess.email || "");
    // Refactor: centralize save logic so modal can trigger it
    async function performSave() {
        const name = document.getElementById("settings-name").value.trim();
        const emailField = document.getElementById("settings-email").value.trim();
        const password = document.getElementById("settings-password").value || "";
        const passwordConfirm = document.getElementById("settings-password-confirm").value || "";

        if (password || passwordConfirm) {
            if (password !== passwordConfirm) {
                showFeedback("As senhas não conferem.", false);
                return;
            }
            if (password.length > 0 && password.length < 8) {
                showFeedback("A senha deve ter no mínimo 8 caracteres.", false);
                return;
            }
        }

        // Save locally so UI reflects change even if backend doesn't support profile update
        if (name) {
            sessionStorage.setItem("userName", name);
        } else {
            sessionStorage.removeItem("userName");
        }

        // Attempt to persist to backend; if not supported, inform user
        const payload = {};
        if (name) payload.name = name;
        if (password) payload.password = password;
        if (emailField) payload.email = emailField;

        if (Object.keys(payload).length === 0) {
            showFeedback("Nenhuma alteração para salvar.", true);
            return;
        }

        const resp = await tryPersistProfileUpdate(payload);
        if (!resp) {
            showFeedback("Alterações salvas localmente. Backend não fornece endpoint de atualização.", true);
            // reflect locally
            sessionStorage.setItem("userName", name);
            if (emailField) sessionStorage.setItem("userEmail", emailField);
            updateProfileCard(name || sessionStorage.getItem("userName"), sessionStorage.getItem("userEmail") || sess.email || "");
            return;
        }

        if (resp.ok) {
            const data = await resp.json().catch(()=>({}));
            showFeedback("Perfil atualizado com sucesso.", true);
            // update UI and cache
            if (name) {
                sessionStorage.setItem("userName", name);
            }
            if (emailField) {
                sessionStorage.setItem("userEmail", emailField);
            }
            updateProfileCard(name || sessionStorage.getItem("userName"), sessionStorage.getItem("userEmail") || sess.email || "");

            if (data && data.email_changed) {
                // If email changed, force logout to refresh token
                showFeedback("E-mail atualizado. Você será deslogado para completar a atualização.", true);
                window.setTimeout(() => {
                    window.AppSession.logout();
                }, 900);
                return;
            }

            return;
        }

        // Backend returned an error (likely 404/405)
        try {
            const data = await resp.json();
            const detail = data.detail || data.message || "Erro ao salvar no servidor.";
            showFeedback(`Salvo localmente. Servidor respondeu: ${detail}`, false);
        } catch (err) {
            showFeedback("Salvo localmente. Backend não oferece atualização de perfil.", true);
        }
    }

    // Wire save button to show modal
    const saveBtn = document.getElementById("settings-save-btn");
    const modal = document.getElementById("settings-confirm-modal");
    const modalOk = document.getElementById("settings-confirm-ok");
    const modalCancel = document.getElementById("settings-confirm-cancel");

    function showModal() {
        if (!modal) return;
        modal.style.display = "block";
        modal.setAttribute('aria-hidden', 'false');
    }

    function hideModal() {
        if (!modal) return;
        modal.style.display = "none";
        modal.setAttribute('aria-hidden', 'true');
    }

    if (saveBtn) {
        saveBtn.addEventListener('click', (e) => {
            e.preventDefault();
            showModal();
        });
    }

    // --- Enhancement: enable save only when changes exist and validation passes ---
    const emailInput = document.getElementById('settings-email');
    const nameInput = document.getElementById('settings-name');
    const passwordInput = document.getElementById('settings-password');
    const passwordConfirmInput = document.getElementById('settings-password-confirm');

    const emailError = document.getElementById('settings-email-error');
    const nameError = document.getElementById('settings-name-error');
    const passError = document.getElementById('settings-password-error');
    const passConfirmError = document.getElementById('settings-password-confirm-error');

    const initialValues = {
        email: sess.email || '',
        name: sessionStorage.getItem('userName') || '',
    };

    function validateEmail(value) {
        const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return re.test(String(value).toLowerCase());
    }

    function validateForm() {
        let valid = true;

        // email
        if (emailInput && emailInput.value) {
            if (!validateEmail(emailInput.value)) {
                emailError.textContent = 'E-mail inválido.';
                valid = false;
            } else {
                emailError.textContent = '';
            }
        } else {
            emailError.textContent = 'E-mail é obrigatório.';
            valid = false;
        }

        // password rules (if provided)
        if (passwordInput && passwordInput.value) {
            if (passwordInput.value.length < 8) {
                passError.textContent = 'Senha deve ter ao menos 8 caracteres.';
                valid = false;
            } else {
                passError.textContent = '';
            }
            if (passwordConfirmInput && passwordInput.value !== passwordConfirmInput.value) {
                passConfirmError.textContent = 'As senhas não conferem.';
                valid = false;
            } else {
                passConfirmError.textContent = '';
            }
        } else {
            passError.textContent = '';
            passConfirmError.textContent = '';
        }

        // name optional but length limit
        if (nameInput && nameInput.value.length > 120) {
            nameError.textContent = 'Nome muito longo.';
            valid = false;
        } else {
            nameError.textContent = '';
        }

        // check if any change
        const changed = (emailInput && emailInput.value !== initialValues.email) || (nameInput && nameInput.value !== initialValues.name) || (passwordInput && passwordInput.value);

        // enable save if changed and valid
        if (saveBtn) {
            saveBtn.disabled = !(changed && valid);
        }
        return valid && changed;
    }

    [emailInput, nameInput, passwordInput, passwordConfirmInput].forEach((el) => {
        if (!el) return;
        el.addEventListener('input', () => {
            validateForm();
            // update password strength live
            if (el === passwordInput) {
                updatePasswordStrength(passwordInput.value);
            }
        });
        el.addEventListener('blur', () => {
            validateForm();
        });
    });

    // show initial values in inputs
    if (emailInput) emailInput.value = initialValues.email;
    if (nameInput) nameInput.value = initialValues.name;

    if (modalCancel) {
        modalCancel.addEventListener('click', (e) => {
            e.preventDefault();
            hideModal();
        });
    }

    if (modalOk) {
        modalOk.addEventListener('click', async (e) => {
            e.preventDefault();
            hideModal();
            // final validation before saving
            if (!validateForm()) {
                showFeedback('Corrija os erros antes de salvar.', false);
                return;
            }
            // show spinner on save button
            if (saveBtn) {
                saveBtn.classList.add('loading');
                saveBtn.disabled = true;
                const spinner = saveBtn.querySelector('.btn-spinner');
                if (spinner) spinner.style.display = 'inline-block';
            }
            try {
                await performSave();
            } finally {
                if (saveBtn) {
                    saveBtn.classList.remove('loading');
                    saveBtn.disabled = false;
                    const spinner = saveBtn.querySelector('.btn-spinner');
                    if (spinner) spinner.style.display = 'none';
                    // re-run validation to set proper disabled state
                    validateForm();
                }
            }
        });
    }

    // Password strength meter
    function scorePassword(pw) {
        let score = 0;
        if (!pw) return 0;
        // length
        if (pw.length >= 8) score += 2;
        else if (pw.length >= 5) score += 1;
        // variety
        if (/[a-z]/.test(pw)) score += 1;
        if (/[A-Z]/.test(pw)) score += 1;
        if (/[0-9]/.test(pw)) score += 1;
        if (/[^A-Za-z0-9]/.test(pw)) score += 1;
        return Math.min(score, 6);
    }

    function updatePasswordStrength(pw) {
        const meter = document.getElementById('settings-password-strength');
        const fill = meter ? meter.querySelector('.strength-fill') : null;
        const text = document.getElementById('settings-password-strength-text');
        if (!meter || !fill || !text) return;
        const s = scorePassword(pw);
        const percent = Math.round((s / 6) * 100);
        fill.style.width = percent + '%';
        meter.setAttribute('aria-hidden', pw ? 'false' : 'true');
        if (!pw) {
            text.textContent = '';
            fill.style.background = '';
            return;
        }
        if (s <= 2) {
            text.textContent = 'Fraca';
            fill.style.background = '#e74c3c';
        } else if (s <= 4) {
            text.textContent = 'Média';
            fill.style.background = '#f1c40f';
        } else {
            text.textContent = 'Forte';
            fill.style.background = '#2ecc71';
        }
    }

    // Toggle show/hide password fields
    document.querySelectorAll('.toggle-password').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const targetId = btn.getAttribute('data-target');
            const input = document.getElementById(targetId);
            if (!input) return;
            if (input.type === 'password') {
                input.type = 'text';
                btn.textContent = 'ocultar';
                btn.setAttribute('aria-label', 'Ocultar senha');
            } else {
                input.type = 'password';
                btn.textContent = 'mostrar';
                btn.setAttribute('aria-label', 'Mostrar senha');
            }
        });
    });

    // initialize strength from existing value (if any)
    if (passwordInput) updatePasswordStrength(passwordInput.value);

    // Keep original cancel behavior: reset fields to session values
    const cancelBtn = document.getElementById('settings-cancel');
    if (cancelBtn) {
        cancelBtn.addEventListener('click', (e) => {
            e.preventDefault();
            const sess2 = window.AppSession.getStoredSession();
            document.getElementById('settings-email').value = sess2.email || '';
            document.getElementById('settings-name').value = sessionStorage.getItem('userName') || '';
            document.getElementById('settings-password').value = '';
            document.getElementById('settings-password-confirm').value = '';
            showFeedback('Edições canceladas.', true);
        });
    }
});
