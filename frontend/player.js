const USER_API_BASE_URL = (window.APP_CONFIG && window.APP_CONFIG.API_BASE_URL) || "http://127.0.0.1:8000";

function createAuthHeaders() {
    const session = window.AppSession.getStoredSession();
    return {
        Authorization: `Bearer ${session.token}`,
    };
}

function buildTrackStreamUrl(streamUrl) {
    return `${USER_API_BASE_URL}${streamUrl}`;
}

function formatDuration(totalSeconds) {
    const seconds = Math.max(0, Math.round(Number(totalSeconds || 0)));
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = seconds % 60;

    if (hours > 0) {
        return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(
            remainingSeconds
        ).padStart(2, "0")}`;
    }

    return `${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
}

function getPlayerParams() {
    const params = new URLSearchParams(window.location.search);
    return {
        audiobookId: params.get("audiobookId") || "",
        title: params.get("title") || "Audiobook sem título",
    };
}

async function fetchTracksByAudiobook(audiobookId) {
    const response = await fetch(`${USER_API_BASE_URL}/library/audiobooks/${audiobookId}/tracks`, {
        method: "GET",
        headers: createAuthHeaders(),
    });

    const data = await response.json();
    if (!response.ok) {
        if (response.status === 401) {
            window.AppSession.logout();
            return [];
        }
        throw new Error(data.detail || "Nao foi possivel carregar as faixas.");
    }

    return data.tracks || [];
}

function renderTrackList(tracks, activeIndex) {
    const listElement = document.getElementById("player-track-list");
    if (!listElement) {
        return;
    }

    if (!tracks.length) {
        listElement.innerHTML = "<p class=\"text-muted\">Nenhuma faixa encontrada para este audiobook.</p>";
        return;
    }

    listElement.innerHTML = tracks
        .map((track, index) => {
            const isActive = index === activeIndex;
            return `
                <button class="player-track-item ${isActive ? "is-active" : ""}" type="button" data-track-index="${index}">
                    <div class="player-track-item-title">${track.order}. ${track.title}</div>
                    <small class="text-muted">Duração: ${formatDuration(track.duration || 0)}</small>
                </button>
            `;
        })
        .join("");
}

function updateCurrentTrackMeta(track, index, count) {
    const metaElement = document.getElementById("current-track-meta");
    if (!metaElement) {
        return;
    }

    if (!track) {
        metaElement.textContent = "";
        return;
    }

    metaElement.textContent = `Tocando ${index + 1} de ${count}: ${track.order}. ${track.title}`;
}

function wirePlayer(tracks, audiobookId) {
    const audioElement = document.getElementById("track-audio");
    const prevButton = document.getElementById("prev-track");
    const nextButton = document.getElementById("next-track");
    const listElement = document.getElementById("player-track-list");

    if (!audioElement || !prevButton || !nextButton || !listElement) {
        return;
    }

    let activeIndex = 0;
    let currentBlobUrl = null;
    let lastPersistAt = 0;
    const stateStorageKey = `audiobook-player:${audiobookId}`;

    function loadSavedState() {
        try {
            const rawValue = localStorage.getItem(stateStorageKey);
            if (!rawValue) {
                return null;
            }

            const parsed = JSON.parse(rawValue);
            if (!parsed || typeof parsed !== "object") {
                return null;
            }

            return {
                activeIndex: Number(parsed.activeIndex),
                currentTime: Number(parsed.currentTime),
                volume: Number(parsed.volume),
            };
        } catch (_error) {
            return null;
        }
    }

    function persistState() {
        if (!tracks.length) {
            return;
        }

        const payload = {
            activeIndex,
            currentTime: Number(audioElement.currentTime || 0),
            volume: Number(audioElement.volume || 1),
            updatedAt: Date.now(),
        };

        try {
            localStorage.setItem(stateStorageKey, JSON.stringify(payload));
        } catch (_error) {
            // Ignora falha de persistencia local para nao interromper o player.
        }
    }

    const savedState = loadSavedState();
    let pendingResumeSeconds = 0;

    if (savedState && Number.isFinite(savedState.activeIndex)) {
        const normalizedIndex = Math.max(0, Math.min(tracks.length - 1, Math.floor(savedState.activeIndex)));
        activeIndex = normalizedIndex;
    }

    if (savedState && Number.isFinite(savedState.currentTime) && savedState.currentTime > 0) {
        pendingResumeSeconds = savedState.currentTime;
    }

    if (savedState && Number.isFinite(savedState.volume)) {
        audioElement.volume = Math.max(0, Math.min(1, savedState.volume));
    }

    function toAbsoluteUrl(streamUrl) {
        return `${USER_API_BASE_URL}${streamUrl}`;
    }

    async function validateStreamUrl(streamUrl) {
        const absoluteUrl = toAbsoluteUrl(streamUrl);
        const response = await fetch(absoluteUrl, {
            method: "GET",
            headers: {
                Range: "bytes=0-1",
            },
        });

        if (!response.ok) {
            let detail = "Falha ao validar stream.";
            try {
                const data = await response.json();
                detail = data.detail || detail;
            } catch (_error) {
                // Mantem mensagem padrao quando resposta nao vier em JSON.
            }

            throw new Error(`HTTP ${response.status} ao abrir faixa: ${detail}`);
        }

        const contentType = response.headers.get("Content-Type") || "desconhecido";
        return {
            absoluteUrl,
            status: response.status,
            contentType,
        };
    }

    function waitForAudioReady(timeoutMs = 12000) {
        return new Promise((resolve, reject) => {
            let timeoutId = null;

            function cleanup() {
                audioElement.removeEventListener("loadedmetadata", onLoaded);
                audioElement.removeEventListener("canplay", onLoaded);
                audioElement.removeEventListener("error", onError);
                if (timeoutId) {
                    window.clearTimeout(timeoutId);
                }
            }

            function onLoaded() {
                cleanup();
                resolve();
            }

            function onError() {
                cleanup();
                reject(new Error("Falha ao carregar mídia da faixa."));
            }

            timeoutId = window.setTimeout(() => {
                cleanup();
                reject(new Error("Tempo de carregamento da faixa excedido."));
            }, timeoutMs);

            audioElement.addEventListener("loadedmetadata", onLoaded);
            audioElement.addEventListener("canplay", onLoaded);
            audioElement.addEventListener("error", onError);
        });
    }

    async function loadTrackAudio(selectedTrack) {
        const response = await fetch(`${USER_API_BASE_URL}${selectedTrack.stream_url}`, {
            method: "GET",
            headers: createAuthHeaders(),
        });

        if (!response.ok) {
            let detail = "Nao foi possivel carregar o audio da faixa.";
            try {
                const data = await response.json();
                detail = data.detail || detail;
            } catch (_error) {
                // Mantem a mensagem padrao quando a resposta nao vier em JSON.
            }
            throw new Error(detail);
        }

        const audioBlob = await response.blob();
        if (currentBlobUrl) {
            URL.revokeObjectURL(currentBlobUrl);
        }

        currentBlobUrl = URL.createObjectURL(audioBlob);
        audioElement.src = currentBlobUrl;
        audioElement.load();
    }

    async function loadTrackAudioByTokenUrl(selectedTrack) {
        const streamCheck = await validateStreamUrl(selectedTrack.stream_url);

        if (currentBlobUrl) {
            URL.revokeObjectURL(currentBlobUrl);
            currentBlobUrl = null;
        }

        audioElement.src = streamCheck.absoluteUrl;
        audioElement.load();
        await waitForAudioReady();
        return streamCheck;
    }

    async function playTrack(index, shouldAutoplay) {
        if (!tracks.length) {
            return;
        }

        activeIndex = index;
        const selectedTrack = tracks[activeIndex];
        const feedbackElement = document.getElementById("player-feedback");
        const shouldResumeAtSavedTime = pendingResumeSeconds > 0;

        renderTrackList(tracks, activeIndex);
        updateCurrentTrackMeta(selectedTrack, activeIndex, tracks.length);
        prevButton.disabled = activeIndex === 0;
        nextButton.disabled = activeIndex === tracks.length - 1;

        if (feedbackElement) {
            feedbackElement.textContent = `Carregando faixa ${selectedTrack.order}...`;
        }

        try {
            const streamCheck = await loadTrackAudioByTokenUrl(selectedTrack);
            if (feedbackElement) {
                feedbackElement.textContent = `${tracks.length} faixa(s) disponível(is). Stream HTTP ${streamCheck.status} (${streamCheck.contentType}).`;
            }
        } catch (error) {
            try {
                // Fallback para navegadores/ambientes com restricao de media URL autenticada.
                await loadTrackAudio(selectedTrack);
                if (feedbackElement) {
                    feedbackElement.textContent = `${tracks.length} faixa(s) disponível(is). Stream via blob autenticado.`;
                }
            } catch (fallbackError) {
                if (feedbackElement) {
                    const failedUrl = toAbsoluteUrl(selectedTrack.stream_url);
                    feedbackElement.textContent = `${fallbackError.message || "Erro ao carregar a faixa."} URL: ${failedUrl}`;
                }
                return;
            }
        }

        if (shouldResumeAtSavedTime) {
            try {
                const maxSeekTime = Number.isFinite(audioElement.duration) && audioElement.duration > 2
                    ? audioElement.duration - 1
                    : pendingResumeSeconds;
                audioElement.currentTime = Math.max(0, Math.min(pendingResumeSeconds, maxSeekTime));
            } catch (_error) {
                // Se o navegador bloquear o seek cedo, segue reproducao sem interromper.
            }
            pendingResumeSeconds = 0;
        }

        persistState();

        if (shouldAutoplay) {
            audioElement.play().catch(() => {
                // Some browsers block autoplay without user interaction.
            });
        }
    }

    prevButton.addEventListener("click", () => {
        if (activeIndex > 0) {
            void playTrack(activeIndex - 1, true);
        }
    });

    nextButton.addEventListener("click", () => {
        if (activeIndex < tracks.length - 1) {
            void playTrack(activeIndex + 1, true);
        }
    });

    listElement.addEventListener("click", (event) => {
        const button = event.target.closest("button[data-track-index]");
        if (!button) {
            return;
        }

        const selectedIndex = Number(button.dataset.trackIndex);
        if (Number.isNaN(selectedIndex)) {
            return;
        }

        void playTrack(selectedIndex, true);
    });

    audioElement.addEventListener("ended", () => {
        pendingResumeSeconds = 0;
        persistState();
        if (activeIndex < tracks.length - 1) {
            void playTrack(activeIndex + 1, true);
        }
    });

    audioElement.addEventListener("timeupdate", () => {
        const now = Date.now();
        if (now - lastPersistAt < 1000) {
            return;
        }
        lastPersistAt = now;
        persistState();
    });

    audioElement.addEventListener("pause", persistState);
    audioElement.addEventListener("volumechange", persistState);

    audioElement.addEventListener("error", () => {
        const feedbackElement = document.getElementById("player-feedback");
        if (!feedbackElement) {
            return;
        }

        const mediaErrorCode = audioElement.error?.code;
        const codeMap = {
            1: "MEDIA_ERR_ABORTED",
            2: "MEDIA_ERR_NETWORK",
            3: "MEDIA_ERR_DECODE",
            4: "MEDIA_ERR_SRC_NOT_SUPPORTED",
        };
        const codeLabel = codeMap[mediaErrorCode] || "UNKNOWN";
        feedbackElement.textContent = `Falha na reproducao da faixa (${codeLabel}).`;
    });

    window.addEventListener("beforeunload", () => {
        persistState();
        if (currentBlobUrl) {
            URL.revokeObjectURL(currentBlobUrl);
        }
    });

    void playTrack(activeIndex, false);
}

async function initPlayerPage() {
    const feedbackElement = document.getElementById("player-feedback");
    const titleElement = document.getElementById("player-title");
    const { audiobookId, title } = getPlayerParams();

    if (titleElement) {
        titleElement.textContent = title;
    }

    if (!audiobookId) {
        if (feedbackElement) {
            feedbackElement.textContent = "Audiobook inválido. Volte para a biblioteca e selecione novamente.";
        }
        return;
    }

    if (feedbackElement) {
        feedbackElement.textContent = "Carregando faixas...";
    }

    try {
        const tracks = await fetchTracksByAudiobook(audiobookId);

        if (!tracks.length) {
            if (feedbackElement) {
                feedbackElement.textContent = "Nenhuma faixa disponível para este audiobook.";
            }
            renderTrackList([], -1);
            return;
        }

        if (feedbackElement) {
            feedbackElement.textContent = `${tracks.length} faixa(s) disponível(is).`;
        }

        wirePlayer(tracks, audiobookId);
    } catch (error) {
        if (feedbackElement) {
            feedbackElement.textContent = error.message || "Erro ao carregar player.";
        }
        renderTrackList([], -1);
    }
}

initPlayerPage();
