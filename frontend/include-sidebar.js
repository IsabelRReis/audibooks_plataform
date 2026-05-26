document.addEventListener("DOMContentLoaded", async () => {
    const aside = document.querySelector("aside[data-include]");
    if (!aside) return;

    const includeType = aside.getAttribute("data-include") || "user";
    const url = `./includes/${includeType}-sidebar.html`;

    try {
        const resp = await fetch(url, { cache: "no-store" });
        if (!resp.ok) return;
        const html = await resp.text();
        aside.innerHTML = html;
        // attach logout handlers if present
        const logoutAdmin = document.getElementById("logout-link-admin");
        if (logoutAdmin) {
            logoutAdmin.addEventListener("click", (e) => {
                e.preventDefault();
                if (window.AppSession && typeof window.AppSession.logout === 'function') {
                    window.AppSession.logout();
                } else {
                    window.location.href = './login.html';
                }
            });
        }

        const logoutUser = document.getElementById("logout-link-user");
        if (logoutUser) {
            logoutUser.addEventListener("click", (e) => {
                e.preventDefault();
                if (window.AppSession && typeof window.AppSession.logout === 'function') {
                    window.AppSession.logout();
                } else {
                    window.location.href = './login.html';
                }
            });
        }

        // initialize sidebar toggle if available
        if (window.AppSession && typeof window.AppSession.initSidebarToggle === 'function') {
            window.AppSession.initSidebarToggle();
        }
    } catch (err) {
        // ignore
    }
});
