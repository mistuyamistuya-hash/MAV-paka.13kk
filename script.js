const storageKey = "vortex-demo-v1";
const fileStorageName = "vortex-shared-files";
const maxFileSize = 25 * 1024 * 1024;
const maxVideoSize = 100 * 1024 * 1024;
const roleNames = { general: "Général", chef: "Chef", "sous-chef": "Sous-chef", membre: "Membre" };
const initialState = {
  currentMemberId: "you",
  activeView: "general",
  members: [
    { id: "you", name: "Jesse", role: "chef" },
    { id: "mila", name: "Mila", role: "sous-chef" },
    { id: "noe", name: "Noé", role: "membre" }
  ],
  memberPresence: { you: true, mila: true, noe: true },
  presenceEvents: [],
  meeting: { active: false, startedAt: null, startedBy: null },
  messages: {
    general: [
      { id: "g1", memberId: "mila", text: "Bienvenue dans le salon général ! Ici, tout le monde peut échanger. ✨", time: Date.now() - 360000 },
      { id: "g2", memberId: "noe", text: "Trop bien, on pourra organiser nos prochaines sorties ici ?", time: Date.now() - 180000 },
      { id: "g3", memberId: "you", text: "Bien sûr ! Le salon est à vous 😄", time: Date.now() - 60000 }
    ],
    chefs: [{ id: "c1", memberId: "mila", text: "Ce salon est réservé à l’équipe de chefs.", time: Date.now() - 100000 }],
    direct: {}
  },
  mediaLinks: [],
  infoPosts: [],
  invitations: []
};

function readState() {
  const stored = localStorage.getItem(storageKey);
  if (!stored) return structuredClone(initialState);
  try {
    const saved = JSON.parse(stored);
    if (!Array.isArray(saved.members) || !saved.messages?.general || !saved.messages?.chefs) {
      throw new Error("Données locales Vortex invalides.");
    }
    const result = { ...structuredClone(initialState), ...saved };
    result.messages = { ...structuredClone(initialState.messages), ...saved.messages, direct: saved.messages.direct || {} };
    result.mediaLinks = Array.isArray(saved.mediaLinks) ? saved.mediaLinks : [];
    result.infoPosts = Array.isArray(saved.infoPosts) ? saved.infoPosts : [];
    const savedPresence = saved.memberPresence && typeof saved.memberPresence === "object" && !Array.isArray(saved.memberPresence)
      ? saved.memberPresence
      : {};
    result.memberPresence = Object.fromEntries(result.members.map((member) => [
      member.id,
      Object.prototype.hasOwnProperty.call(savedPresence, member.id) ? Boolean(savedPresence[member.id]) : true
    ]));
    result.presenceEvents = Array.isArray(saved.presenceEvents) ? saved.presenceEvents : [];
    result.meeting = saved.meeting && typeof saved.meeting === "object"
      ? { active: Boolean(saved.meeting.active), startedAt: saved.meeting.startedAt || null, startedBy: saved.meeting.startedBy || null }
      : structuredClone(initialState.meeting);
    return result;
  } catch (error) {
    console.error("Impossible de lire les données enregistrées de Vortex.", error);
    return structuredClone(initialState);
  }
}

let state = readState();
let toastTimer;
let voiceJoined = false;
let fileDatabasePromise;
let mediaPreviewUrls = [];
let meetingMicStream = null;
let meetingAudioContext = null;
let meetingAnalyser = null;
let microphoneAnimationFrame = null;
let microphoneMuted = false;
const $ = (selector) => document.querySelector(selector);
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
})[character]);
const memberById = (id) => (window.vortexCloud?.members || state.members).find((member) => member.id === id);
const currentMember = () => window.vortexCloud?.member || memberById(state.currentMemberId) || state.members[0];
const initials = (name) => Array.from(name.trim())[0]?.toLocaleUpperCase("fr") || "?";
const formatTime = (time) => new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" }).format(time);

function openFileDatabase() {
  if (fileDatabasePromise) return fileDatabasePromise;
  fileDatabasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(fileStorageName, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("files")) {
        request.result.createObjectStore("files", { keyPath: "id" });
      }
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(request.error || new Error("Impossible d’ouvrir le stockage des fichiers."));
  });
  return fileDatabasePromise;
}

function getStoredFiles() {
  return openFileDatabase().then((database) => new Promise((resolve, reject) => {
    const request = database.transaction("files", "readonly").objectStore("files").getAll();
    request.onsuccess = () => resolve(request.result.sort((a, b) => b.addedAt - a.addedAt));
    request.onerror = () => reject(request.error || new Error("Impossible de lire les fichiers."));
  }));
}

function storeFile(file) {
  return openFileDatabase().then((database) => new Promise((resolve, reject) => {
    const transaction = database.transaction("files", "readwrite");
    transaction.objectStore("files").put(file);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error || new Error("Impossible d’enregistrer le fichier."));
  }));
}

function removeStoredFile(id) {
  return openFileDatabase().then((database) => new Promise((resolve, reject) => {
    const transaction = database.transaction("files", "readwrite");
    transaction.objectStore("files").delete(id);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error || new Error("Impossible de supprimer le fichier."));
  }));
}

function humanFileSize(size) {
  if (size < 1024) return `${size} octets`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} Ko`;
  return `${(size / (1024 * 1024)).toFixed(1)} Mo`;
}

async function renderFiles() {
  try {
    const files = (await getStoredFiles()).filter((file) => file.kind !== "video");
    $("#file-count").textContent = String(files.length);
    $("#file-list").innerHTML = files.length ? files.map((file) => `
      <article class="stored-file">
        <span class="stored-file-icon">▤</span>
        <span class="stored-file-details"><strong title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</strong><small>${humanFileSize(file.size)} · Ajouté par ${escapeHtml(file.addedBy)}</small></span>
        <button type="button" data-file-download="${escapeHtml(file.id)}" aria-label="Télécharger ${escapeHtml(file.name)}" title="Télécharger">↓</button>
        <button type="button" data-file-delete="${escapeHtml(file.id)}" aria-label="Supprimer ${escapeHtml(file.name)}" title="Supprimer">×</button>
      </article>
    `).join("") : '<p class="empty-state">Aucun fichier enregistré pour le moment.</p>';
  } catch (error) {
    console.error("Impossible de charger les fichiers locaux.", error);
    $("#file-list").innerHTML = '<p class="empty-state">Le stockage des fichiers est indisponible dans ce navigateur.</p>';
  }
}

function validTikTokLink(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && (url.hostname === "tiktok.com" || url.hostname.endsWith(".tiktok.com"));
  } catch {
    return false;
  }
}

function renderInfoPosts() {
  const posts = [...state.infoPosts].sort((a, b) => b.time - a.time);
  $("#info-post-count").textContent = String(posts.length);
  $("#info-post-list").innerHTML = posts.length ? posts.map((post) => `
    <article class="info-post">
      <div class="info-post-heading"><div><h3>${escapeHtml(post.title)}</h3><span>Par ${escapeHtml(post.author)} · ${formatTime(post.time)}</span></div>
        <button type="button" data-info-delete="${escapeHtml(post.id)}" aria-label="Supprimer l’information : ${escapeHtml(post.title)}" title="Supprimer">×</button>
      </div>
      <p>${escapeHtml(post.text)}</p>
    </article>
  `).join("") : '<p class="empty-state">Aucune information publiée pour le moment.</p>';
}

function renderPresencePanel() {
  const selector = $("#presence-member");
  const selectedId = selector.value;
  selector.innerHTML = state.members.map((member) =>
    `<option value="${escapeHtml(member.id)}">${escapeHtml(member.name)}${state.memberPresence[member.id] ? " · présent" : " · absent"}</option>`
  ).join("");
  if (state.members.some((member) => member.id === selectedId)) selector.value = selectedId;
  const isPresent = Boolean(state.memberPresence[selector.value]);
  $("#presence-arrive").disabled = isPresent;
  $("#presence-leave").disabled = !isPresent;
  const presentCount = state.members.filter((member) => state.memberPresence[member.id]).length;
  $("#presence-count").textContent = String(presentCount);
  $("#presence-label").textContent = "présents";
  const events = [...state.presenceEvents].sort((a, b) => b.time - a.time);
  $("#presence-event-count").textContent = String(events.length);
  $("#presence-event-list").innerHTML = events.length ? events.map((item) => {
    const isArrival = item.type === "arrival";
    return `<article class="presence-event ${isArrival ? "arrival-event" : "departure-event"}">
      <span class="presence-event-icon" aria-hidden="true">${isArrival ? "↗" : "↙"}</span>
      <div><strong>${escapeHtml(item.name)} ${isArrival ? "est arrivé(e)" : "est parti(e)"}</strong><small>${formatTime(item.time)}</small></div>
    </article>`;
  }).join("") : '<p class="empty-state">Aucune arrivée ni aucun départ enregistré.</p>';
}

function recordPresenceChange(type) {
  const member = memberById($("#presence-member").value);
  if (!member) {
    showToast("Choisis une personne de l’équipe.");
    return;
  }
  const isArrival = type === "arrival";
  const isPresent = Boolean(state.memberPresence[member.id]);
  if (isArrival === isPresent) {
    showToast(isArrival ? `${member.name} est déjà indiqué(e) comme présent(e).` : `${member.name} est déjà indiqué(e) comme absent(e).`);
    return;
  }
  const previousPresence = state.memberPresence[member.id];
  const event = { id: crypto.randomUUID(), memberId: member.id, name: member.name, type, time: Date.now() };
  state.memberPresence[member.id] = isArrival;
  state.presenceEvents.push(event);
  state.presenceEvents = state.presenceEvents.slice(-100);
  try {
    saveState();
    renderPresencePanel();
    showToast(isArrival ? `🔔 ${member.name} est arrivé(e).` : `🔔 ${member.name} est parti(e).`);
  } catch (error) {
    state.memberPresence[member.id] = previousPresence;
    state.presenceEvents = state.presenceEvents.filter((item) => item.id !== event.id);
    console.error("Impossible d’enregistrer ce changement de présence.", error);
    showToast("Impossible d’enregistrer cette arrivée ou ce départ.");
  }
}

function renderMeetingPanel() {
  const canManageMeeting = currentMember().role === "general";
  $("#meeting-start").hidden = state.meeting.active || !canManageMeeting;
  $("#meeting-end").hidden = !state.meeting.active || !canManageMeeting;
  $("#meeting-permission-note").hidden = canManageMeeting;
  $("#meeting-status").textContent = state.meeting.active ? "La réunion est en cours" : "Aucune réunion en cours";
  $("#meeting-status").classList.toggle("meeting-active", state.meeting.active);
  $("#meeting-started-by").textContent = state.meeting.active
    ? `Lancée par ${state.meeting.startedBy || "un membre"} · ${formatTime(state.meeting.startedAt)}`
    : "Quand une réunion sera lancée, son état apparaîtra ici.";
  $("#meeting-microphone").hidden = !state.meeting.active;
  renderMeetingMicrophone();
}

function renderMeetingMicrophone() {
  const isActive = meetingMicStream?.getAudioTracks().some((track) => track.readyState === "live") || false;
  $("#microphone-enable").hidden = isActive;
  $("#microphone-mute").hidden = !isActive;
  $("#microphone-stop").hidden = !isActive;
  $("#microphone-mute").textContent = microphoneMuted ? "Réactiver le micro" : "Couper le micro";
  $("#microphone-status").textContent = !isActive
    ? "Micro désactivé"
    : microphoneMuted ? "Micro coupé" : "Micro actif sur cet appareil";
  $("#microphone-status-dot").classList.toggle("microphone-on", isActive && !microphoneMuted);
  $("#microphone-status-dot").classList.toggle("microphone-muted", isActive && microphoneMuted);
  if (!isActive || microphoneMuted) setMicrophoneLevel(0);
}

function setMicrophoneLevel(level) {
  const safeLevel = Math.max(0, Math.min(100, Math.round(level)));
  $("#microphone-meter-fill").style.width = `${safeLevel}%`;
  $("#microphone-meter").setAttribute("aria-valuenow", String(safeLevel));
}

function monitorMicrophoneLevel() {
  if (!meetingAnalyser || microphoneMuted) return;
  const samples = new Uint8Array(meetingAnalyser.fftSize);
  meetingAnalyser.getByteTimeDomainData(samples);
  const sum = samples.reduce((total, sample) => total + (sample - 128) ** 2, 0);
  const rms = Math.sqrt(sum / samples.length) / 128;
  setMicrophoneLevel(Math.min(100, rms * 280));
  microphoneAnimationFrame = window.requestAnimationFrame(monitorMicrophoneLevel);
}

function stopMeetingMicrophone() {
  if (microphoneAnimationFrame !== null) {
    window.cancelAnimationFrame(microphoneAnimationFrame);
    microphoneAnimationFrame = null;
  }
  if (meetingMicStream) {
    meetingMicStream.getTracks().forEach((track) => track.stop());
    meetingMicStream = null;
  }
  if (meetingAudioContext) {
    const context = meetingAudioContext;
    meetingAudioContext = null;
    meetingAnalyser = null;
    context.close().catch((error) => console.error("Impossible de fermer le traitement audio local.", error));
  }
  microphoneMuted = false;
  if ($("#microphone-status")) renderMeetingMicrophone();
}

function microphoneErrorMessage(error) {
  if (error.name === "NotAllowedError" || error.name === "PermissionDeniedError") {
    return "L’accès au micro est refusé. Autorise le micro dans les réglages du navigateur puis réessaie.";
  }
  if (error.name === "NotFoundError" || error.name === "DevicesNotFoundError") {
    return "Aucun micro n’a été trouvé sur cet appareil.";
  }
  if (error.name === "NotReadableError" || error.name === "TrackStartError") {
    return "Le micro est indisponible. Ferme les autres applications qui l’utilisent puis réessaie.";
  }
  if (error.name === "SecurityError" || !navigator.mediaDevices?.getUserMedia) {
    return "Le micro nécessite un navigateur compatible et une page sécurisée HTTPS (ou localhost).";
  }
  return "Impossible d’activer le micro. Vérifie ses autorisations et réessaie.";
}

async function enableMeetingMicrophone() {
  if (!state.meeting.active) {
    showToast("Lance d’abord la réunion pour activer le micro.");
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    showToast(microphoneErrorMessage({ name: "NotSupportedError" }));
    return;
  }
  $("#microphone-enable").disabled = true;
  $("#microphone-status").textContent = "Demande d’autorisation du micro…";
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false
    });
    if (!state.meeting.active) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    meetingMicStream = stream;
    microphoneMuted = false;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error("Web Audio indisponible.");
    meetingAudioContext = new AudioContextClass();
    meetingAnalyser = meetingAudioContext.createAnalyser();
    meetingAnalyser.fftSize = 256;
    meetingAudioContext.createMediaStreamSource(stream).connect(meetingAnalyser);
    stream.getAudioTracks().forEach((track) => {
      track.addEventListener("ended", () => {
        if (meetingMicStream === stream) {
          stopMeetingMicrophone();
          showToast("Le micro a été déconnecté.");
        }
      });
    });
    renderMeetingMicrophone();
    microphoneAnimationFrame = window.requestAnimationFrame(monitorMicrophoneLevel);
    showToast("Micro activé sur cet appareil.");
  } catch (error) {
    if (meetingMicStream) stopMeetingMicrophone();
    $("#microphone-status").textContent = "Micro désactivé";
    console.error("Impossible d’activer le micro de la réunion.", error);
    showToast(microphoneErrorMessage(error));
  } finally {
    $("#microphone-enable").disabled = false;
  }
}

async function renderMedia() {
  try {
    mediaPreviewUrls.forEach((url) => URL.revokeObjectURL(url));
    mediaPreviewUrls = [];
    const videos = (await getStoredFiles()).filter((item) => item.kind === "video");
    const items = [
      ...videos.map((video) => ({ ...video, mediaType: "video" })),
      ...state.mediaLinks.map((link) => ({ ...link, mediaType: "link" }))
    ].sort((a, b) => b.addedAt - a.addedAt);

    $("#media-count").textContent = String(items.length);
    $("#media-list").innerHTML = items.length ? items.map((item) => {
      if (item.mediaType === "video") {
        const previewUrl = URL.createObjectURL(item.blob);
        mediaPreviewUrls.push(previewUrl);
        return `
          <article class="media-item">
            <div class="media-preview"><video controls preload="metadata" src="${previewUrl}"></video></div>
            <div class="media-item-details"><strong title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</strong><span>Vidéo locale · ${humanFileSize(item.size)} · par ${escapeHtml(item.addedBy)}</span></div>
            <button class="media-delete" type="button" data-media-delete="${escapeHtml(item.id)}" aria-label="Supprimer ${escapeHtml(item.name)}">×</button>
          </article>
        `;
      }
      return `
      <article class="media-item media-link-item">
        <span class="media-link-icon" aria-hidden="true">▶</span>
        <div class="media-item-details"><strong>Lien TikTok</strong><a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.url)}</a><span>Ajouté par ${escapeHtml(item.addedBy)}</span></div>
        <button class="media-delete" type="button" data-media-link-delete="${escapeHtml(item.id)}" aria-label="Supprimer le lien TikTok">×</button>
      </article>
      `;
    }).join("") : '<p class="empty-state">Aucune vidéo ni aucun lien pour le moment.</p>';
  } catch (error) {
    console.error("Impossible de charger les médias locaux.", error);
    $("#media-list").innerHTML = '<p class="empty-state">Le stockage des vidéos est indisponible dans ce navigateur.</p>';
  }
}

function saveState() {
  localStorage.setItem(storageKey, JSON.stringify(state));
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("visible"), 2800);
}

function directMessagesWith(memberId) {
  if (!state.messages.direct[memberId]) state.messages.direct[memberId] = [];
  return state.messages.direct[memberId];
}

function renderDirectList() {
  const otherMembers = (window.vortexCloud?.members || state.members).filter((member) => member.id !== currentMember().id);
  $("#direct-list").innerHTML = otherMembers.length
    ? otherMembers.map((member) => {
      const messages = directMessagesWith(member.id);
      const lastMessage = messages.at(-1);
      return `<button type="button" class="nav-item direct-item ${state.activeView === `dm:${member.id}` ? "selected" : ""}" data-dm="${escapeHtml(member.id)}">
        <span class="person-avatar">${escapeHtml(initials(member.name))}</span>
        <span class="direct-name">${escapeHtml(member.name)}</span>
        ${lastMessage ? '<i class="direct-unread" aria-label="Conversation active"></i>' : ""}
      </button>`;
    }).join("")
    : '<p class="no-contacts">Ajoute une personne pour démarrer une conversation privée.</p>';
  $("#direct-list").querySelectorAll("[data-dm]").forEach((button) => {
    button.addEventListener("click", () => openDirectMessage(button.dataset.dm));
  });
}

function renderMessages() {
  const view = state.activeView;
  if (window.vortexCloud?.active) window.vortexCloud.view = view;
  const isDirect = view.startsWith("dm:");
  const isVoice = view === "voice";
  const isFiles = view === "files";
  const isMedia = view === "media";
  const isInfo = view === "info";
  const isActivity = view === "activity";
  const isMeeting = view === "meeting";
  const otherMember = isDirect ? memberById(view.slice(3)) : null;
  let messages;
  $("#presence-count").parentElement.hidden = isFiles || isMedia || isInfo || isMeeting;
  $("#messages").hidden = isVoice || isFiles || isMedia || isInfo || isActivity || isMeeting;
  $("#voice-panel").hidden = !isVoice;
  $("#files-panel").hidden = !isFiles;
  $("#media-panel").hidden = !isMedia;
  $("#info-panel").hidden = !isInfo;
  $("#activity-panel").hidden = !isActivity;
  $("#meeting-panel").hidden = !isMeeting;
  $("#message-form").hidden = isVoice || isFiles || isMedia || isInfo || isActivity || isMeeting;
  $("#conversation-note").hidden = isVoice || isFiles || isMedia || isInfo || isActivity || isMeeting;
  if (isVoice) {
    $("#view-icon").textContent = "♫";
    $("#view-title").textContent = "salon-vocal";
    $("#view-description").textContent = "Salon vocal de démonstration";
    $("#conversation-kicker").textContent = "SALON VOCAL · DÉMO LOCALE";
    $("#conversation-icon").textContent = "♫";
    $("#conversation-title").textContent = "salon-vocal";
    $("#presence-count").textContent = voiceJoined ? "1" : "0";
    $("#presence-label").textContent = "participants";
    $("#voice-title").textContent = voiceJoined ? "Tu as rejoint le salon" : "Le salon est libre";
    $("#voice-description").textContent = voiceJoined
      ? "Tu es seul dans cette démo locale : aucun autre membre ne peut t’entendre."
      : "Rejoins le salon pour afficher les commandes d’appel de démonstration.";
    $("#voice-join").hidden = voiceJoined;
    $("#voice-leave").hidden = !voiceJoined;
    $("#access-notice").hidden = true;
  } else if (isFiles) {
    $("#view-icon").textContent = "▤";
    $("#view-title").textContent = "fichiers";
    $("#view-description").textContent = "Fichiers enregistrés sur cet appareil";
    $("#conversation-kicker").textContent = "ESPACE DE FICHIERS · LOCAL";
    $("#conversation-icon").textContent = "▤";
    $("#conversation-title").textContent = "fichiers";
    $("#presence-count").textContent = "Local";
    $("#presence-label").textContent = "";
    $("#access-notice").hidden = true;
    renderFiles();
  } else if (isMedia) {
    $("#view-icon").textContent = "▶";
    $("#view-title").textContent = "médias";
    $("#view-description").textContent = "Vidéos et liens TikTok enregistrés ici";
    $("#conversation-kicker").textContent = "ESPACE MÉDIAS · LOCAL";
    $("#conversation-icon").textContent = "▶";
    $("#conversation-title").textContent = "médias";
    $("#presence-count").textContent = "Local";
    $("#presence-label").textContent = "";
    $("#access-notice").hidden = true;
    renderMedia();
  } else if (isInfo) {
    $("#view-icon").textContent = "ⓘ";
    $("#view-title").textContent = "informations";
    $("#view-description").textContent = "Découvrir les fonctions de Vortex";
    $("#conversation-kicker").textContent = "À PROPOS DE VORTEX";
    $("#conversation-icon").textContent = "ⓘ";
    $("#conversation-title").textContent = "informations";
    $("#presence-count").textContent = "Info";
    $("#presence-label").textContent = "";
    $("#access-notice").hidden = true;
    renderInfoPosts();
  } else if (isActivity) {
    $("#view-icon").textContent = "↕";
    $("#view-title").textContent = "arrivées-départs";
    $("#view-description").textContent = "Suivre la présence de l’équipe";
    $("#conversation-kicker").textContent = "ACTIVITÉ DE L’ÉQUIPE · LOCAL";
    $("#conversation-icon").textContent = "↕";
    $("#conversation-title").textContent = "arrivées et départs";
    $("#access-notice").hidden = true;
    renderPresencePanel();
  } else if (isMeeting) {
    $("#view-icon").textContent = "♟";
    $("#view-title").textContent = "réunion";
    $("#view-description").textContent = "Réunion d’équipe";
    $("#conversation-kicker").textContent = "RÉUNION D’ÉQUIPE · LOCAL";
    $("#conversation-icon").textContent = "♟";
    $("#conversation-title").textContent = "réunion";
    $("#access-notice").hidden = true;
    renderMeetingPanel();
  } else if (isDirect) {
    if (!otherMember) {
      state.activeView = "general";
      render();
      return;
    }
    messages = directMessagesWith(otherMember.id);
    $("#view-icon").textContent = "✉";
    $("#view-title").textContent = otherMember.name;
    $("#view-description").textContent = `Conversation privée avec ${otherMember.name}`;
    $("#conversation-kicker").textContent = "MESSAGE PRIVÉ";
    $("#conversation-icon").textContent = "✉";
    $("#conversation-title").textContent = otherMember.name;
    $("#presence-count").textContent = "Privé";
    $("#presence-label").textContent = "";
    $("#message-input").placeholder = `Écrire un message à ${otherMember.name}...`;
    $("#conversation-note").textContent = "Cette conversation reste enregistrée dans ce navigateur.";
  } else {
    const isPrivateChannel = view === "chefs";
    const permitted = !isPrivateChannel || (window.vortexCloud?.active
      ? ["chef", "general"].includes(currentMember().role)
      : currentMember().role === "chef");
    $("#view-icon").textContent = isPrivateChannel ? "▣" : "#";
    $("#view-title").textContent = isPrivateChannel ? "entre-chefs" : "général";
    $("#view-description").textContent = isPrivateChannel ? "Un espace privé pour les chefs" : "Le salon de tout le monde";
    $("#conversation-kicker").textContent = "SALON DE DISCUSSION";
    $("#conversation-icon").textContent = isPrivateChannel ? "▣" : "#";
    $("#conversation-title").textContent = isPrivateChannel ? "entre-chefs" : "général";
    $("#presence-count").textContent = String(window.vortexCloud?.active
      ? window.vortexCloud.members.length
      : state.members.length);
    $("#presence-label").textContent = "membres";
    $("#message-input").placeholder = `Écrire dans #${isPrivateChannel ? "entre-chefs" : "général"}...`;
    $("#conversation-note").textContent = window.vortexCloud?.active
      ? "Les messages sont partagés avec les membres connectés."
      : "Les messages sont enregistrés dans ce navigateur.";
    $("#access-notice").hidden = permitted;
    $("#access-notice").textContent = permitted ? "" : "Ce salon est réservé aux chefs et au rôle Général.";
    $("#message-form").hidden = !permitted;
    if (!permitted) {
      $("#messages").innerHTML = "";
      return;
    }
    messages = state.messages[view] || [];
  }

  if (isVoice || isFiles || isMedia || isInfo || isActivity || isMeeting) return;
  $("#access-notice").hidden = true;
  $("#message-form").hidden = false;
  $("#messages").innerHTML = messages.map((message) => {
    const member = memberById(message.memberId);
    const name = member?.name || message.name || "Ancien membre";
    const role = member?.role || message.role;
    const roleBadge = role && roleNames[role] ? `<span class="role-badge">${escapeHtml(roleNames[role])}</span>` : "";
    return `<article class="message">
      <span class="person-avatar">${escapeHtml(initials(name))}</span>
      <div class="message-content">
        <div class="message-meta"><strong>${escapeHtml(name)}</strong>${roleBadge}<time datetime="${new Date(message.time).toISOString()}">${formatTime(message.time)}</time></div>
        <p>${escapeHtml(message.text)}</p>
      </div>
    </article>`;
  }).join("") || `<div class="access-notice">${isDirect ? `C’est le début de ta conversation privée avec ${escapeHtml(otherMember.name)}. Envoie-lui un message !` : "Pas encore de message. Lance la conversation !"}</div>`;
  if (!isDirect && window.vortexCloud?.active && ["general", "chefs"].includes(view)) {
    window.vortexCloud.renderMessages();
  }
  $("#messages").scrollTop = $("#messages").scrollHeight;
}

function render() {
  $("#profile-name").textContent = currentMember().name;
  $("#profile-avatar").textContent = initials(currentMember().name);
  $("#current-role").value = currentMember().role;
  $("#current-role").disabled = Boolean(window.vortexCloud?.active);
  renderDirectList();
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.classList.toggle("selected", button.dataset.view === state.activeView);
  });
  renderMessages();
}

function openDirectMessage(memberId) {
  if (!memberById(memberId)) return;
  state.activeView = `dm:${memberId}`;
  directMessagesWith(memberId);
  saveState();
  render();
  $("#message-input").focus();
}

$("#message-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const text = $("#message-input").value.trim();
  if (!text) return;
  if (window.vortexCloud?.active) {
    window.vortexCloud.sendMessage(text);
    $("#message-input").value = "";
    return;
  }
  const isDirect = state.activeView.startsWith("dm:");
  if (state.activeView === "chefs" && !(window.vortexCloud?.active
    ? ["chef", "general"].includes(currentMember().role)
    : currentMember().role === "chef")) {
    showToast("Ce salon est réservé aux chefs.");
    return;
  }
  const targetMessages = isDirect
    ? directMessagesWith(state.activeView.slice(3))
    : state.messages[state.activeView];
  if (!targetMessages) return;
  targetMessages.push({
    id: crypto.randomUUID(),
    memberId: currentMember().id,
    text,
    time: Date.now()
  });
  $("#message-input").value = "";
  saveState();
  render();
  $("#message-input").focus();
});

document.querySelectorAll("[data-view]").forEach((button) => {
  button.addEventListener("click", () => {
    if (button.dataset.view === "chefs" && !(window.vortexCloud?.active
      ? ["chef", "general"].includes(currentMember().role)
      : currentMember().role === "chef")) {
      showToast("Ce salon est réservé aux chefs.");
      return;
    }
    if (state.activeView === "meeting" && button.dataset.view !== "meeting" && meetingMicStream) {
      stopMeetingMicrophone();
      showToast("Micro coupé en quittant la réunion.");
    }
    if (state.activeView === "voice" && button.dataset.view !== "voice") voiceJoined = false;
    state.activeView = button.dataset.view;
    saveState();
    render();
  });
});

$("#presence-member").addEventListener("change", renderPresencePanel);
$("#presence-arrive").addEventListener("click", () => recordPresenceChange("arrival"));
$("#presence-leave").addEventListener("click", () => recordPresenceChange("departure"));

$("#meeting-start").addEventListener("click", () => {
  if (currentMember().role !== "general") {
    showToast("Seul le rôle Général peut lancer la réunion.");
    renderMeetingPanel();
    return;
  }
  if (state.meeting.active) return;
  const previousMeeting = state.meeting;
  state.meeting = { active: true, startedAt: Date.now(), startedBy: currentMember().name };
  try {
    saveState();
    renderMeetingPanel();
    showToast("🔔 La réunion a commencé.");
  } catch (error) {
    state.meeting = previousMeeting;
    console.error("Impossible d’enregistrer le démarrage de la réunion.", error);
    showToast("Impossible de lancer la réunion.");
  }
});

$("#meeting-end").addEventListener("click", () => {
  if (currentMember().role !== "general") {
    showToast("Seul le rôle Général peut terminer la réunion.");
    renderMeetingPanel();
    return;
  }
  if (!state.meeting.active) return;
  const previousMeeting = state.meeting;
  state.meeting = { active: false, startedAt: null, startedBy: null };
  try {
    saveState();
    stopMeetingMicrophone();
    renderMeetingPanel();
    showToast("La réunion est terminée.");
  } catch (error) {
    state.meeting = previousMeeting;
    console.error("Impossible d’enregistrer la fin de la réunion.", error);
    showToast("Impossible de terminer la réunion.");
  }
});

$("#microphone-enable").addEventListener("click", enableMeetingMicrophone);
$("#microphone-mute").addEventListener("click", () => {
  if (!meetingMicStream) return;
  microphoneMuted = !microphoneMuted;
  meetingMicStream.getAudioTracks().forEach((track) => { track.enabled = !microphoneMuted; });
  if (microphoneMuted && microphoneAnimationFrame !== null) {
    window.cancelAnimationFrame(microphoneAnimationFrame);
    microphoneAnimationFrame = null;
  }
  renderMeetingMicrophone();
  showToast(microphoneMuted ? "Micro coupé." : "Micro réactivé.");
  if (!microphoneMuted && meetingAnalyser && microphoneAnimationFrame === null) {
    microphoneAnimationFrame = window.requestAnimationFrame(monitorMicrophoneLevel);
  }
});
$("#microphone-stop").addEventListener("click", () => {
  stopMeetingMicrophone();
  showToast("Micro déconnecté.");
});

$("#voice-join").addEventListener("click", () => {
  voiceJoined = true;
  render();
  showToast("Salon vocal de démonstration rejoint.");
});
$("#voice-leave").addEventListener("click", () => {
  voiceJoined = false;
  render();
  showToast("Salon vocal quitté.");
});

$("#file-input").addEventListener("change", async (event) => {
  const files = Array.from(event.target.files || []);
  event.target.value = "";
  for (const file of files) {
    if (file.size > maxFileSize) {
      showToast(`${file.name} dépasse la limite de 25 Mo.`);
      continue;
    }
    try {
      await storeFile({
        id: crypto.randomUUID(),
        name: file.name,
        size: file.size,
        type: file.type || "application/octet-stream",
        addedBy: currentMember().name,
        addedAt: Date.now(),
        blob: file
      });
    } catch (error) {
      console.error("Impossible d’enregistrer le fichier sélectionné.", error);
      showToast(`Impossible d’enregistrer ${file.name}.`);
    }
  }
  await renderFiles();
});

$("#file-list").addEventListener("click", async (event) => {
  const downloadButton = event.target.closest("[data-file-download]");
  const deleteButton = event.target.closest("[data-file-delete]");
  try {
    if (deleteButton) {
      await removeStoredFile(deleteButton.dataset.fileDelete);
      await renderFiles();
      showToast("Fichier supprimé de ce navigateur.");
    }
    if (downloadButton) {
      const file = (await getStoredFiles()).find((item) => item.id === downloadButton.dataset.fileDownload);
      if (!file) {
        showToast("Ce fichier n’est plus disponible.");
        return;
      }
      const url = URL.createObjectURL(file.blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = file.name;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60000);
    }
  } catch (error) {
    console.error("Impossible d’effectuer cette action sur le fichier.", error);
    showToast("Impossible d’effectuer cette action sur le fichier.");
  }
});

$("#video-input").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  if (!file.type.startsWith("video/")) {
    showToast("Choisis un fichier vidéo.");
    return;
  }
  if (file.size > maxVideoSize) {
    showToast(`${file.name} dépasse la limite de 100 Mo.`);
    return;
  }
  try {
    await storeFile({
      id: crypto.randomUUID(),
      kind: "video",
      name: file.name,
      size: file.size,
      type: file.type,
      addedBy: currentMember().name,
      addedAt: Date.now(),
      blob: file
    });
    await renderMedia();
    showToast("Vidéo ajoutée à tes médias.");
  } catch (error) {
    console.error("Impossible d’enregistrer la vidéo sélectionnée.", error);
    showToast("Impossible d’enregistrer cette vidéo dans le navigateur.");
  }
});

$("#media-link-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const input = $("#media-link-input");
  const value = input.value.trim();
  if (!validTikTokLink(value)) {
    showToast("Entre un lien TikTok sécurisé commençant par https://.");
    input.focus();
    return;
  }
  const url = new URL(value).href;
  if (state.mediaLinks.some((link) => link.url === url)) {
    showToast("Ce lien TikTok est déjà dans tes médias.");
    return;
  }
  const link = {
    id: crypto.randomUUID(),
    url,
    addedBy: currentMember().name,
    addedAt: Date.now()
  };
  state.mediaLinks.push(link);
  try {
    saveState();
    input.value = "";
    renderMedia();
    showToast("Lien TikTok ajouté à tes médias.");
  } catch (error) {
    state.mediaLinks = state.mediaLinks.filter((item) => item.id !== link.id);
    console.error("Impossible d’enregistrer le lien TikTok.", error);
    showToast("Impossible d’enregistrer ce lien dans le navigateur.");
  }
});

$("#media-list").addEventListener("click", async (event) => {
  const videoButton = event.target.closest("[data-media-delete]");
  const linkButton = event.target.closest("[data-media-link-delete]");
  if (!videoButton && !linkButton) return;
  if (linkButton) {
    const previousLinks = state.mediaLinks;
    state.mediaLinks = previousLinks.filter((link) => link.id !== linkButton.dataset.mediaLinkDelete);
    try {
      saveState();
      await renderMedia();
      showToast("Lien TikTok supprimé.");
    } catch (error) {
      state.mediaLinks = previousLinks;
      console.error("Impossible de supprimer le lien TikTok.", error);
      showToast("Impossible de supprimer ce lien.");
    }
    return;
  }
  try {
    await removeStoredFile(videoButton.dataset.mediaDelete);
    await renderMedia();
    showToast("Vidéo supprimée de ce navigateur.");
  } catch (error) {
    console.error("Impossible de supprimer la vidéo.", error);
    showToast("Impossible de supprimer cette vidéo.");
  }
});

$("#info-post-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const titleInput = $("#info-post-title");
  const textInput = $("#info-post-text");
  const title = titleInput.value.trim();
  const text = textInput.value.trim();
  if (!title || !text) {
    showToast("Ajoute un titre et le texte de l’information.");
    return;
  }
  const post = {
    id: crypto.randomUUID(),
    title: title.slice(0, 80),
    text: text.slice(0, 2000),
    author: currentMember().name,
    time: Date.now()
  };
  state.infoPosts.push(post);
  try {
    saveState();
    titleInput.value = "";
    textInput.value = "";
    renderInfoPosts();
    showToast("Information publiée.");
  } catch (error) {
    state.infoPosts = state.infoPosts.filter((item) => item.id !== post.id);
    console.error("Impossible d’enregistrer l’information.", error);
    showToast("Impossible d’enregistrer cette information.");
  }
});

$("#info-post-list").addEventListener("click", (event) => {
  const deleteButton = event.target.closest("[data-info-delete]");
  if (!deleteButton) return;
  const previousPosts = state.infoPosts;
  state.infoPosts = previousPosts.filter((post) => post.id !== deleteButton.dataset.infoDelete);
  try {
    saveState();
    renderInfoPosts();
    showToast("Information supprimée.");
  } catch (error) {
    state.infoPosts = previousPosts;
    console.error("Impossible de supprimer l’information.", error);
    showToast("Impossible de supprimer cette information.");
  }
});

$("#current-role").addEventListener("change", (event) => {
  if (window.vortexCloud?.active) {
    event.target.value = currentMember().role;
    return;
  }
  currentMember().role = event.target.value;
  if (event.target.value !== "chef" && state.activeView === "chefs") state.activeView = "general";
  saveState();
  render();
});

$("#add-person").addEventListener("click", () => {
  if (window.vortexCloud?.active) {
    showToast("Demande à cette personne de créer son propre compte Vortex.");
    return;
  }
  $("#person-name").value = "";
  $("#person-dialog").showModal();
  $("#person-name").focus();
});

$("#person-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const name = $("#person-name").value.trim();
  if (!name) return;
  if (state.members.some((member) => member.name.toLocaleLowerCase("fr") === name.toLocaleLowerCase("fr"))) {
    showToast("Une personne porte déjà ce pseudo.");
    return;
  }
  const member = { id: crypto.randomUUID(), name, role: "membre" };
  state.members.push(member);
  state.memberPresence[member.id] = false;
  directMessagesWith(member.id);
  state.activeView = `dm:${member.id}`;
  saveState();
  $("#person-dialog").close();
  render();
  showToast(`${name} est dans ta liste de messages privés.`);
});

$("#change-pseudo").addEventListener("click", () => {
  if (window.vortexCloud?.active) {
    window.vortexCloud.changeNickname();
    return;
  }
  $("#pseudo-input").value = currentMember().name;
  $("#pseudo-dialog").showModal();
  $("#pseudo-input").focus();
  $("#pseudo-input").select();
});

$("#pseudo-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const name = $("#pseudo-input").value.trim();
  if (!name) return;
  currentMember().name = name.slice(0, 24);
  saveState();
  $("#pseudo-dialog").close();
  render();
  showToast(`Ton pseudo est maintenant ${currentMember().name}.`);
});

$("#invite-button").addEventListener("click", () => {
  if (window.vortexCloud?.active) {
    window.vortexCloud.showInvite();
    return;
  }
  const token = crypto.randomUUID().replaceAll("-", "").slice(0, 12);
  state.invitations.push(token);
  saveState();
  $("#invite-link").value = `${location.href.split("#")[0]}#invitation=${token}`;
  $("#invite-feedback").textContent = "Cette invitation est une démo locale. La personne devra ouvrir le lien dans ce navigateur, sur cet appareil.";
  $("#invite-dialog").showModal();
});

$("#copy-invite").addEventListener("click", async () => {
  const input = $("#invite-link");
  try {
    await navigator.clipboard.writeText(input.value);
    $("#invite-feedback").textContent = "Lien copié.";
    showToast("Lien d’invitation copié.");
  } catch (error) {
    input.select();
    const copied = document.execCommand("copy");
    if (copied) {
      $("#invite-feedback").textContent = "Lien copié.";
      showToast("Lien d’invitation copié.");
    } else {
      console.error("La copie du lien a échoué.", error);
      $("#invite-feedback").textContent = "Copie impossible. Sélectionne le lien pour le copier.";
    }
  }
});

const invitationToken = new URLSearchParams(location.hash.slice(1)).get("invitation");
if (invitationToken && state.invitations.includes(invitationToken)) {
  $("#person-dialog").showModal();
  $("#person-name").focus();
}

window.addEventListener("pagehide", stopMeetingMicrophone);

render();

const stormIntro = $("#storm-intro");
const stormEnterButton = $("#storm-enter");
stormEnterButton.focus();
stormEnterButton.addEventListener("click", () => {
  stormIntro.classList.add("is-leaving");
  $(".app-shell").removeAttribute("inert");
  window.setTimeout(() => stormIntro.remove(), 650);
});
