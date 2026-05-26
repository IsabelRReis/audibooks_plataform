function getStoredSession() {
    const expiresAtRaw = sessionStorage.getItem("authExpiresAt");
    const expiresAt = expiresAtRaw ? Number(expiresAtRaw) : null;

    return {
        token: sessionStorage.getItem("authToken"),
        profile: sessionStorage.getItem("userProfile"),
        email: sessionStorage.getItem("userEmail"),
        expiresAt,
    };
}

function normalizeProfile(profile) {
    if (profile === "Usuario") {
        return "Usuário";
    }
    return profile;
}

function redirectByProfile(profile) {
    const normalized = normalizeProfile(profile);

    if (normalized === "Admin") {
        window.location.href = "./admin-dashboard.html";
        return;
    }
    window.location.href = "./index.html";
}

function protectRoute(requiredProfile) {
    const session = getStoredSession();
    const normalizedProfile = normalizeProfile(session.profile);
    const normalizedRequired = normalizeProfile(requiredProfile);

    if (!session.token || !normalizedProfile) {
        window.location.href = "./login.html";
        return;
    }

    if (session.expiresAt && Date.now() >= session.expiresAt) {
        logout();
        return;
    }

    if (normalizedProfile === "Admin") {
        if (normalizedRequired && normalizedRequired !== "Admin") {
            window.location.href = "./admin-dashboard.html";
            return;
        }
        return;
    }

    if (normalizedRequired && normalizedProfile !== normalizedRequired) {
        redirectByProfile(normalizedProfile);
    }
}

function logout() {
    sessionStorage.removeItem("authToken");
    sessionStorage.removeItem("userProfile");
    sessionStorage.removeItem("userEmail");
    sessionStorage.removeItem("authExpiresAt");
    window.location.href = "./login.html";
}

function initSidebarToggle() {
    const aside = document.querySelector("aside");
    const menuBtn = document.getElementById("menu-btn");
    const closeBtn = document.getElementById("close-btn");

    if (!aside || !menuBtn || !closeBtn) {
        return;
    }

    function closeSidebar() {
        document.body.classList.remove("sidebar-open");
    }

    menuBtn.addEventListener("click", () => {
        document.body.classList.add("sidebar-open");
    });

    closeBtn.addEventListener("click", closeSidebar);

    aside.querySelectorAll(".sidebar a").forEach((link) => {
        link.addEventListener("click", () => {
            if (window.innerWidth <= 860) {
                closeSidebar();
            }
        });
    });

    window.addEventListener("resize", () => {
        if (window.innerWidth > 860) {
            closeSidebar();
        }
    });
}

document.addEventListener("DOMContentLoaded", initSidebarToggle);

window.AppSession = {
    getStoredSession,
    protectRoute,
    logout,
    initSidebarToggle,
};
