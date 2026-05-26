(function configureFrontend() {
    const appConfig = window.APP_CONFIG || {};
    const localHosts = new Set(["localhost", "127.0.0.1"]);
    const isLocal = localHosts.has(window.location.hostname);

    if (!appConfig.API_BASE_URL) {
        appConfig.API_BASE_URL = isLocal ? "http://127.0.0.1:8000" : "/api";
    }

    window.APP_CONFIG = appConfig;
})();