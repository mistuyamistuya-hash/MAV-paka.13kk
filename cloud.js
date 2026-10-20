import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = "https://rqramdexfpppqgxvdsfj.supabase.co";
const supabaseKey = "sb_publishable_zXC3GbMe1td9mNxkNgpU-w_YiI43jz9";
const client = createClient(supabaseUrl, supabaseKey);
const authGate = document.querySelector("#auth-gate");
const authForm = document.querySelector("#auth-form");
const feedback = document.querySelector("#auth-feedback");
const nicknameInput = document.querySelector("#auth-nickname");
const emailInput = document.querySelector("#auth-email");
const passwordInput = document.querySelector("#auth-password");
let signInMode = false;
let channelMessages = [];
let realtimeChannel;

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
})[character]);

function showError(error, prefix = "Impossible de se connecter à Vortex") {
  console.error(prefix, error);
  feedback.textContent = `${prefix} : ${error.message || "vérifie ta connexion et réessaie."}`;
}

function mapProfile(profile) {
  return { id: profile.id, name: profile.nickname, role: profile.role };
}

function renderMessages() {
  const view = window.vortexCloud?.view || document.querySelector("#view-title").textContent;
  const channelName = view === "chefs" ? "chefs" : "general";
  const visibleMessages = channelMessages.filter((message) => message.channel === channelName);
  const container = document.querySelector("#messages");
  container.innerHTML = visibleMessages.map((message) => {
    const author = message.profiles || {};
    const time = new Date(message.created_at);
    const roleName = { general: "Général", chef: "Chef", "sous-chef": "Sous-chef", membre: "Membre" }[author.role] || "Membre";
    return `<article class="message">
      <span class="person-avatar">${escapeHtml(Array.from(author.nickname || "?")[0].toLocaleUpperCase("fr"))}</span>
      <div class="message-content">
        <div class="message-meta"><strong>${escapeHtml(author.nickname || "Membre")}</strong><span class="role-badge">${roleName}</span><time datetime="${time.toISOString()}">${new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" }).format(time)}</time></div>
        <p>${escapeHtml(message.content)}</p>
      </div>
    </article>`;
  }).join("") || '<div class="access-notice">Pas encore de message. Lance la conversation !</div>';
  container.scrollTop = container.scrollHeight;
}

async function loadMessages() {
  const { data, error } = await client
    .from("messages")
    .select("id,channel,sender_id,content,created_at,profiles(nickname,role)")
    .in("channel", ["general", "chefs"])
    .order("created_at", { ascending: true })
    .limit(300);
  if (error) throw error;
  channelMessages = data;
  renderMessages();
}

async function loadMembers() {
  const { data, error } = await client.from("profiles").select("id,nickname,role").order("nickname");
  if (error) throw error;
  window.vortexCloud.members = data.map(mapProfile);
  window.vortexCloud.member = window.vortexCloud.members.find((member) => member.id === window.vortexCloud.member.id);
  if (!window.vortexCloud.member) throw new Error("Ton profil Vortex n’a pas été trouvé.");
  document.querySelector("#profile-name").textContent = window.vortexCloud.member.name;
  document.querySelector("#profile-avatar").textContent = Array.from(window.vortexCloud.member.name)[0].toLocaleUpperCase("fr");
  document.querySelector("#current-role").value = window.vortexCloud.member.role;
  document.querySelector("#presence-count").textContent = String(window.vortexCloud.members.length);
  document.querySelector("#direct-list").innerHTML = window.vortexCloud.members
    .filter((member) => member.id !== window.vortexCloud.member.id)
    .map((member) => `<div class="nav-item direct-item"><span class="person-avatar">${escapeHtml(Array.from(member.name)[0].toLocaleUpperCase("fr"))}</span><span class="direct-name">${escapeHtml(member.name)}</span></div>`)
    .join("") || '<p class="no-contacts">Tu es le premier membre connecté.</p>';
}

async function signedIn(session) {
  if (!session) {
    window.vortexCloud = { active: false };
    document.querySelector(".app-shell").inert = true;
    authGate.hidden = false;
    feedback.textContent = "";
    return;
  }

  const { data: profile, error } = await client
    .from("profiles")
    .select("id,nickname,role")
    .eq("id", session.user.id)
    .single();
  if (error) {
    showError(error, "Le profil de ton compte est introuvable");
    await client.auth.signOut();
    return;
  }

  window.vortexCloud = {
    active: true,
    member: mapProfile(profile),
    members: [mapProfile(profile)],
    view: "general",
    renderMessages,
    sendMessage,
    changeNickname,
    showInvite
  };
  document.querySelector(".app-shell").inert = false;
  document.querySelector("#connection-label").textContent = "Connecté";
  document.querySelector("#connection-description").textContent = "Salon partagé · Supabase";
  document.querySelector("#current-role").disabled = true;
  authGate.hidden = true;
  document.querySelector("#profile-name").textContent = profile.nickname;
  document.querySelector("#profile-avatar").textContent = Array.from(profile.nickname)[0].toLocaleUpperCase("fr");
  document.querySelector("#view-description").textContent = "Le salon partagé de tout le monde";
  document.querySelector('[data-view="general"]').click();

  try {
    await Promise.all([loadMembers(), loadMessages()]);
    document.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => {
      window.vortexCloud.view = button.dataset.view;
      if (["general", "chefs"].includes(button.dataset.view)) renderMessages();
    }));
    if (realtimeChannel) await client.removeChannel(realtimeChannel);
    realtimeChannel = client.channel("vortex-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, loadMessages)
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, loadMembers)
      .subscribe();
    document.querySelector("#messages").dataset.cloudReady = "true";
    document.querySelector("#conversation-note").textContent = "Les messages sont partagés avec les membres connectés.";
    document.querySelector("#message-input").placeholder = "Écrire dans le salon partagé...";
    window.dispatchEvent(new Event("vortex-cloud-ready"));
  } catch (error) {
    showError(error, "Impossible de charger le salon partagé");
  }
}

async function sendMessage(text) {
  const channel = window.vortexCloud.view === "chefs" ? "chefs" : "general";
  const { error } = await client.from("messages").insert({
    channel,
    sender_id: window.vortexCloud.member.id,
    content: text
  });
  if (error) {
    console.error("Impossible d’envoyer le message partagé.", error);
    document.querySelector("#toast").textContent = `Message non envoyé : ${error.message}`;
    document.querySelector("#toast").classList.add("visible");
    return;
  }
  await loadMessages();
}

async function changeNickname() {
  const nickname = window.prompt("Choisis ton pseudo (24 caractères maximum)", window.vortexCloud.member.name);
  if (!nickname?.trim()) return;
  const nextNickname = nickname.trim().slice(0, 24);
  const { error } = await client.from("profiles").update({ nickname: nextNickname }).eq("id", window.vortexCloud.member.id);
  if (error) {
    document.querySelector("#toast").textContent = `Pseudo non modifié : ${error.message}`;
    document.querySelector("#toast").classList.add("visible");
    return;
  }
  window.vortexCloud.member.name = nextNickname;
  await loadMembers();
}

function showInvite() {
  document.querySelector("#invite-link").value = location.origin + location.pathname;
  document.querySelector("#invite-feedback").textContent = "Partage ce lien. Chaque personne crée son compte pour rejoindre le salon général comme Membre.";
  document.querySelector("#invite-dialog").showModal();
}

document.querySelector("#auth-mode-toggle").addEventListener("click", () => {
  signInMode = !signInMode;
  nicknameInput.hidden = signInMode;
  nicknameInput.required = !signInMode;
  document.querySelector('label[for="auth-nickname"]').hidden = signInMode;
  passwordInput.autocomplete = signInMode ? "current-password" : "new-password";
  document.querySelector("#auth-title").textContent = signInMode ? "Content de te revoir" : "Bienvenue sur Vortex";
  document.querySelector("#auth-description").textContent = signInMode
    ? "Connecte-toi pour retrouver le salon partagé."
    : "Crée ton compte pour rejoindre le salon général comme membre.";
  document.querySelector("#auth-submit").textContent = signInMode ? "Se connecter" : "Créer mon compte · rôle Membre";
  document.querySelector("#auth-mode-toggle").textContent = signInMode
    ? "Nouveau sur Vortex ? Créer un compte"
    : "Déjà inscrit ? Se connecter";
  feedback.textContent = "";
});

authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  feedback.textContent = "Connexion à Supabase…";
  document.querySelector("#auth-submit").disabled = true;
  try {
    if (signInMode) {
      const { error } = await client.auth.signInWithPassword({
        email: emailInput.value.trim(),
        password: passwordInput.value
      });
      if (error) throw error;
    } else {
      const { data, error } = await client.auth.signUp({
        email: emailInput.value.trim(),
        password: passwordInput.value,
        options: {
          data: { nickname: nicknameInput.value.trim().slice(0, 24) },
          emailRedirectTo: location.origin + location.pathname
        }
      });
      if (error) throw error;
      if (!data.session) feedback.textContent = "Compte créé. Vérifie ton e-mail pour confirmer l’inscription, puis connecte-toi.";
    }
  } catch (error) {
    showError(error, signInMode ? "Connexion impossible" : "Création du compte impossible");
  } finally {
    document.querySelector("#auth-submit").disabled = false;
  }
});

document.querySelector("#sign-out-button").addEventListener("click", async () => {
  const { error } = await client.auth.signOut();
  if (error) showError(error, "Déconnexion impossible");
});

document.querySelector("#invite-button").addEventListener("click", (event) => {
  event.stopImmediatePropagation();
  showInvite();
}, true);
document.querySelector("#change-pseudo").addEventListener("click", (event) => {
  event.stopImmediatePropagation();
  changeNickname();
}, true);
document.querySelector("#add-person").addEventListener("click", (event) => {
  event.stopImmediatePropagation();
  document.querySelector("#toast").textContent = "Partage le lien Inviter : chaque personne rejoint avec son compte.";
  document.querySelector("#toast").classList.add("visible");
}, true);

client.auth.onAuthStateChange((_event, session) => {
  window.setTimeout(() => signedIn(session).catch((error) => showError(error)), 0);
});
