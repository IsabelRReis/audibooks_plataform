const API_BASE_URL = (window.APP_CONFIG && window.APP_CONFIG.API_BASE_URL) || "http://127.0.0.1:8000";

async function handleRegister(form) {
    const feedback = document.getElementById("register-feedback");
    const formData = new FormData(form);

    const payload = {
        name: String(formData.get("name") || "").trim(),
        email: String(formData.get("email") || "").trim(),
        password: String(formData.get("password") || ""),
    };

    feedback.textContent = "";
    feedback.classList.remove("success");

    if (payload.password.length < 8) {
        feedback.textContent = "A senha deve ter no minimo 8 caracteres.";
        return;
    }

    try {
        const response = await fetch(`${API_BASE_URL}/auth/register`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });

        const data = await response.json();

        if (!response.ok) {
            feedback.textContent = data.detail || "Erro ao cadastrar.";
            return;
        }

        feedback.textContent = "Cadastro realizado. Redirecionando para o login...";
        feedback.classList.add("success");

        const redirectTo = data.redirect_to || "/login.html";
        window.setTimeout(() => {
            window.location.href = redirectTo;
        }, 900);
    } catch (error) {
        feedback.textContent = "Nao foi possivel conectar ao servidor.";
    }
}

async function handleLogin(form) {
    const feedback = document.getElementById("login-feedback");
    const formData = new FormData(form);

    const payload = {
        email: String(formData.get("email") || "").trim(),
        password: String(formData.get("password") || ""),
    };

    feedback.textContent = "";
    feedback.classList.remove("success");

    try {
        const response = await fetch(`${API_BASE_URL}/auth/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });

        const data = await response.json();

        if (!response.ok) {
            feedback.textContent = data.detail || "Credenciais invalidas.";
            return;
        }

        sessionStorage.removeItem("authExpiresAt");
        sessionStorage.setItem("authToken", data.access_token || "");
        sessionStorage.setItem("userProfile", data.profile || "Usuário");
        sessionStorage.setItem("userEmail", data.email || "");

        if (data.expires_in) {
            const expiresAt = Date.now() + Number(data.expires_in) * 1000;
            sessionStorage.setItem("authExpiresAt", String(expiresAt));
        }

        feedback.textContent = "Login realizado com sucesso.";
        feedback.classList.add("success");

        const redirectTo = data.redirect_to || "./index.html";

        window.setTimeout(() => {
            window.location.href = redirectTo;
        }, 500);
    } catch (error) {
        feedback.textContent = "Nao foi possivel conectar ao servidor.";
    }
}

const registerForm = document.getElementById("register-form");
if (registerForm) {
    registerForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        await handleRegister(registerForm);
    });
}

const loginForm = document.getElementById("login-form");
if (loginForm) {
    loginForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        await handleLogin(loginForm);
    });
}
