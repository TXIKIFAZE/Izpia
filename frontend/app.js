// app.js
// Lógica del cliente Friends: login/registro, lista de contactos,
// chat en tiempo real vía WebSocket.

const API_URL = FRIENDS_CONFIG.API_URL;

// ---------- Estado en memoria ----------

let state = {
  token: null,
  me: null,            // { id, username, displayName }
  contacts: [],         // [{ id, username, displayName }]
  selectedContact: null,
  onlineIds: new Set(),
  socket: null,
  messagesByContact: {}, // contactId -> [mensajes]
};

// ---------- Elementos del DOM ----------

const authScreen = document.getElementById('auth-screen');
const appScreen = document.getElementById('app-screen');

const loginForm = document.getElementById('login-form');
const registerForm = document.getElementById('register-form');
const loginError = document.getElementById('login-error');
const registerError = document.getElementById('register-error');

const tabs = document.querySelectorAll('.tab');

const meName = document.getElementById('me-name');
const logoutBtn = document.getElementById('logout-btn');
const contactList = document.getElementById('contact-list');

const chatEmpty = document.getElementById('chat-empty');
const chatActive = document.getElementById('chat-active');
const chatContactName = document.getElementById('chat-contact-name');
const chatContactStatus = document.getElementById('chat-contact-status');
const messagesEl = document.getElementById('messages');
const messageForm = document.getElementById('message-form');
const messageInput = document.getElementById('message-input');
const typingIndicator = document.getElementById('typing-indicator');
const backBtn = document.getElementById('back-btn');

// ---------- Utilidades ----------

function initials(name) {
  return (name || '?').trim().charAt(0).toUpperCase();
}

function formatTime(timestamp) {
  const d = new Date(timestamp);
  return d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
}

async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (state.token) headers['Authorization'] = `Bearer ${state.token}`;

  const res = await fetch(`${API_URL}${path}`, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Algo salió mal.');
  return data;
}

// ---------- Tabs de login / registro ----------

tabs.forEach(tab => {
  tab.addEventListener('click', () => {
    tabs.forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    const isLogin = tab.dataset.tab === 'login';
    loginForm.classList.toggle('hidden', !isLogin);
    registerForm.classList.toggle('hidden', isLogin);
  });
});

// ---------- Registro ----------

registerForm.addEventListener('submit', async e => {
  e.preventDefault();
  registerError.textContent = '';

  const displayName = document.getElementById('register-displayname').value.trim();
  const username = document.getElementById('register-username').value.trim();
  const password = document.getElementById('register-password').value;

  try {
    const data = await api('/api/register', {
      method: 'POST',
      body: JSON.stringify({ username, password, displayName }),
    });
    onAuthenticated(data.token, data.user);
  } catch (err) {
    registerError.textContent = err.message;
  }
});

// ---------- Login ----------

loginForm.addEventListener('submit', async e => {
  e.preventDefault();
  loginError.textContent = '';

  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;

  try {
    const data = await api('/api/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    onAuthenticated(data.token, data.user);
  } catch (err) {
    loginError.textContent = err.message;
  }
});

// ---------- Sesión ----------

function onAuthenticated(token, user) {
  state.token = token;
  state.me = user;
  sessionStorage.setItem('friends_token', token);

  authScreen.classList.add('hidden');
  appScreen.classList.remove('hidden');
  meName.textContent = user.displayName;

  connectSocket();
  loadContacts();
}

logoutBtn.addEventListener('click', () => {
  if (state.socket) state.socket.close();
  sessionStorage.removeItem('friends_token');
  state = { ...state, token: null, me: null, contacts: [], selectedContact: null, socket: null };
  appScreen.classList.add('hidden');
  authScreen.classList.remove('hidden');
});

// Restaurar sesión si ya había un token guardado (recarga de página).
async function tryRestoreSession() {
  const saved = sessionStorage.getItem('friends_token');
  if (!saved) return;
  state.token = saved;
  try {
    const data = await api('/api/me');
    onAuthenticated(saved, data.user);
  } catch {
    sessionStorage.removeItem('friends_token');
  }
}

// ---------- Contactos ----------

async function loadContacts() {
  try {
    const data = await api('/api/contacts');
    state.contacts = data.contacts;
    renderContacts();
  } catch (err) {
    console.error('No se pudieron cargar los contactos:', err.message);
  }
}

function renderContacts() {
  contactList.innerHTML = '';

  if (state.contacts.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-contacts';
    empty.textContent = 'Todavía no hay nadie más registrado. Invita a un amigo a crear su cuenta en Friends.';
    contactList.appendChild(empty);
    return;
  }

  state.contacts.forEach(contact => {
    const row = document.createElement('div');
    row.className = 'contact';
    if (state.selectedContact && state.selectedContact.id === contact.id) {
      row.classList.add('selected');
    }

    const isOnline = state.onlineIds.has(contact.id);

    row.innerHTML = `
      <div class="contact-avatar ${isOnline ? 'online' : ''}">${initials(contact.displayName)}</div>
      <div class="contact-info">
        <div class="contact-name">${escapeHtml(contact.displayName)}</div>
        <div class="contact-sub">${isOnline ? 'En línea' : 'Desconectado'}</div>
      </div>
    `;
    row.addEventListener('click', () => selectContact(contact));
    contactList.appendChild(row);
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ---------- Selección de contacto y carga de historial ----------

async function selectContact(contact) {
  state.selectedContact = contact;
  renderContacts();

  chatEmpty.classList.add('hidden');
  chatActive.classList.remove('hidden');
  chatContactName.textContent = contact.displayName;
  updateContactStatus();

  document.getElementById('app-screen').classList.add('show-chat');

  if (!state.messagesByContact[contact.id]) {
    try {
      const data = await api(`/api/history/${contact.id}`);
      state.messagesByContact[contact.id] = data.messages;
    } catch {
      state.messagesByContact[contact.id] = [];
    }
  }

  renderMessages();
}

backBtn.addEventListener('click', () => {
  document.getElementById('app-screen').classList.remove('show-chat');
});

function updateContactStatus() {
  if (!state.selectedContact) return;
  const isOnline = state.onlineIds.has(state.selectedContact.id);
  chatContactStatus.textContent = isOnline ? 'En línea' : '';
}

function renderMessages() {
  if (!state.selectedContact) return;
  const msgs = state.messagesByContact[state.selectedContact.id] || [];

  messagesEl.innerHTML = '';
  msgs.forEach(msg => {
    const row = document.createElement('div');
    row.className = `msg-row ${msg.from === state.me.id ? 'mine' : 'theirs'}`;
    row.innerHTML = `
      <div class="bubble">
        ${escapeHtml(msg.text)}
        <span class="bubble-time">${formatTime(msg.timestamp)}</span>
      </div>
    `;
    messagesEl.appendChild(row);
  });

  messagesEl.scrollTop = messagesEl.scrollHeight;
}

// ---------- Envío de mensajes ----------

messageForm.addEventListener('submit', e => {
  e.preventDefault();
  const text = messageInput.value.trim();
  if (!text || !state.selectedContact || !state.socket) return;

  state.socket.send(JSON.stringify({
    type: 'chat_message',
    to: state.selectedContact.id,
    text,
  }));

  messageInput.value = '';
});

let typingTimeout = null;
messageInput.addEventListener('input', () => {
  if (!state.selectedContact || !state.socket) return;
  state.socket.send(JSON.stringify({ type: 'typing', to: state.selectedContact.id }));
});

// ---------- WebSocket ----------

function connectSocket() {
  const wsUrl = API_URL.replace(/^http/, 'ws') + `/ws?token=${state.token}`;
  const socket = new WebSocket(wsUrl);
  state.socket = socket;

  socket.addEventListener('message', event => {
    const data = JSON.parse(event.data);

    if (data.type === 'chat_message' || data.type === 'chat_message_sent') {
      const msg = data.message;
      const otherId = msg.from === state.me.id ? msg.to : msg.from;

      if (!state.messagesByContact[otherId]) state.messagesByContact[otherId] = [];
      state.messagesByContact[otherId].push(msg);

      if (state.selectedContact && state.selectedContact.id === otherId) {
        renderMessages();
      }
    }

    if (data.type === 'presence') {
      state.onlineIds = new Set(data.online);
      renderContacts();
      updateContactStatus();
    }

    if (data.type === 'typing') {
      if (state.selectedContact && state.selectedContact.id === data.from) {
        typingIndicator.classList.remove('hidden');
        clearTimeout(typingTimeout);
        typingTimeout = setTimeout(() => typingIndicator.classList.add('hidden'), 2000);
      }
    }
  });

  socket.addEventListener('close', () => {
    // Reintenta la conexión si la sesión sigue activa.
    if (state.token) setTimeout(connectSocket, 2000);
  });
}

// ---------- Arranque ----------

tryRestoreSession();
