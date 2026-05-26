const USER_API_BASE_URL = (window.APP_CONFIG && window.APP_CONFIG.API_BASE_URL) || "http://127.0.0.1:8000";
const LIBRARY_REFRESH_INTERVAL_MS = 5000;
const LIBRARY_ERROR_TOAST_COOLDOWN_MS = 15000;
let isLibraryLoading = false;
let libraryErrorToastAt = 0;
let hadLibraryLoadError = false;

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
		window.setTimeout(() => {
			toast.remove();
		}, 240);
	}, 2800);
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

function updateLibrarySummary(items) {
	const countElement = document.getElementById("library-count");

	if (countElement) {
		countElement.textContent = String(items.length);
	}
}

function createAuthHeaders() {
	const session = window.AppSession.getStoredSession();
	return {
		Authorization: `Bearer ${session.token}`,
	};
}

async function fetchTracksByAudiobook(audiobookId) {
	const response = await fetch(`${USER_API_BASE_URL}/library/audiobooks/${audiobookId}/tracks`, {
		method: "GET",
		headers: createAuthHeaders(),
	});

	const data = await response.json();
	if (!response.ok) {
		throw new Error(data.detail || "Nao foi possivel carregar as faixas.");
	}

	return data.tracks || [];
}

function openAudiobookPlayer(audiobookId, title) {
	if (!audiobookId) {
		return;
	}

	const params = new URLSearchParams({
		audiobookId,
		title: title || "Audiobook sem titulo",
	});

	window.location.href = `./player.html?${params.toString()}`;
}

function renderLibraryCards(items) {
	const cardsContainer = document.getElementById("library-cards");
	if (!cardsContainer) {
		return;
	}

	cardsContainer.innerHTML = "";

	if (!items.length) {
		cardsContainer.innerHTML = `
			<article class="library-card library-card-empty">
				<h3>Nenhum audiobook liberado</h3>
				<p>Assim que um administrador liberar conteúdo para você, ele aparecerá aqui.</p>
			</article>
		`;

		return;
	}

	for (const item of items) {
		const card = document.createElement("article");
		card.className = "library-card";
		card.dataset.audiobookId = item.id;

		card.innerHTML = `
			<h3>${item.title || "Sem título"}</h3>
			<p><strong>Faixas:</strong> ${item.track_count ?? 0}</p>
			<p><strong>Duração:</strong> ${formatDuration(item.total_duration_seconds || 0)}</p>
			<div class="library-card-actions">
				<button class="library-btn library-btn-secondary" data-action="open-player">Player</button>
				<button class="library-btn library-btn-secondary" data-action="toggle-tracks">Ver faixas</button>
			</div>
			<div class="library-tracks" hidden></div>
		`;

		cardsContainer.appendChild(card);
	}

	cardsContainer.querySelectorAll("button[data-action='open-player']").forEach((button) => {
		button.addEventListener("click", (event) => {
			event.preventDefault();
			const card = event.currentTarget.closest(".library-card");
			if (!card) {
				return;
			}

			const audiobookId = card.dataset.audiobookId;
			const titleElement = card.querySelector("h3");
			const title = titleElement ? titleElement.textContent : "Audiobook sem titulo";
			openAudiobookPlayer(audiobookId, title);
		});
	});

	cardsContainer.querySelectorAll("button[data-action='toggle-tracks']").forEach((button) => {
		button.addEventListener("click", async (event) => {
			event.preventDefault();
			const card = event.currentTarget.closest(".library-card");
			if (!card) {
				return;
			}

			const audiobookId = card.dataset.audiobookId;
			const tracksContainer = card.querySelector(".library-tracks");
			if (!tracksContainer) {
				return;
			}

			if (!tracksContainer.hidden) {
				tracksContainer.hidden = true;
				event.currentTarget.textContent = "Ver faixas";
				return;
			}

			tracksContainer.hidden = false;
			event.currentTarget.textContent = "Ocultar faixas";
			tracksContainer.innerHTML = "<p>Carregando faixas...</p>";

			try {
				const tracks = await fetchTracksByAudiobook(audiobookId);
				if (!tracks.length) {
					tracksContainer.innerHTML = "<p>Nenhuma faixa encontrada.</p>";
					return;
				}

				tracksContainer.innerHTML = `
					<div class="library-tracks-header-action">
						<button class="library-btn library-btn-secondary" data-action="open-player-inline">Abrir player deste audiobook</button>
					</div>
				` + tracks
					.map(
						(track, index) => `
							<div class="track-row" data-track-id="${track.id}">
								<div>
									<strong>${track.order}. ${track.title}</strong>
									<small class="text-muted">Página ${index + 1} de ${tracks.length}</small>
									<p>Duração: ${formatDuration(track.duration || 0)}</p>
								</div>
							</div>
						`
					)
					.join("");

				const openPlayerInlineBtn = tracksContainer.querySelector("button[data-action='open-player-inline']");
				if (openPlayerInlineBtn) {
					openPlayerInlineBtn.addEventListener("click", (openPlayerEvent) => {
						openPlayerEvent.preventDefault();
						const titleElement = card.querySelector("h3");
						const title = titleElement ? titleElement.textContent : "Audiobook sem titulo";
						openAudiobookPlayer(audiobookId, title);
					});
				}

			} catch (error) {
				tracksContainer.innerHTML = `<p>${error.message || "Erro ao carregar faixas."}</p>`;
			}
		});
	});
}

async function loadUserLibrary() {
	if (isLibraryLoading) {
		return;
	}

	isLibraryLoading = true;
	const feedback = document.getElementById("library-feedback");
	const session = window.AppSession.getStoredSession();

	if (!session.token) {
		window.AppSession.logout();
		return;
	}

	if (feedback) {
		feedback.textContent = "Carregando seus audiobooks...";
	}

	try {
		const response = await fetch(`${USER_API_BASE_URL}/library/audiobooks`, {
			method: "GET",
			headers: createAuthHeaders(),
		});

		const data = await response.json();
		if (!response.ok) {
			if (response.status === 401) {
				window.AppSession.logout();
				return;
			}
			throw new Error(data.detail || "Não foi possível carregar a biblioteca.");
		}

		const items = data.items || [];
		renderLibraryCards(items);
		updateLibrarySummary(items);
		if (hadLibraryLoadError) {
			showToast("Biblioteca atualizada novamente.", "success");
			hadLibraryLoadError = false;
		}

		if (feedback) {
			feedback.textContent = `${items.length} audiobook(s) disponível(is).`;
		}
	} catch (error) {
		renderLibraryCards([]);
		updateLibrarySummary([]);
		const now = Date.now();
		if (now - libraryErrorToastAt > LIBRARY_ERROR_TOAST_COOLDOWN_MS) {
			showToast(error.message || "Erro ao carregar biblioteca.", "error");
			libraryErrorToastAt = now;
		}
		hadLibraryLoadError = true;

		if (feedback) {
			feedback.textContent = error.message || "Erro ao carregar biblioteca.";
		}
	} finally {
		isLibraryLoading = false;
	}
}

loadUserLibrary();
window.setInterval(loadUserLibrary, LIBRARY_REFRESH_INTERVAL_MS);
