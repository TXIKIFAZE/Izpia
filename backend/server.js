// server.js
// Servidor de Friends: HTTP para registro/login, WebSocket para chat
// en tiempo real. Sin frameworks pesados: usa 'http' nativo de Node
// más la librería 'ws' para WebSocket.

const http = require('http');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const db = require('./db');
const auth = require('./auth');

const PORT = process.env.PORT || 3000;

// ---------- Utilidades HTTP ----------

function sendJSON(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => (raw += chunk));
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function getTokenFromRequest(req) {
  const header = req.headers['authorization'] || '';
  const [, token] = header.split(' '); // "Bearer <token>"
  return token || null;
}

// Devuelve una versión "pública" del usuario, sin datos sensibles.
function publicUser(user) {
  return { id: user.id, username: user.username, displayName: user.displayName };
}

// ---------- Rutas HTTP ----------

async function handleRegister(req, res) {
  const { username, password, displayName } = await readBody(req);

  if (!username || !password) {
    return sendJSON(res, 400, { error: 'Falta usuario o contraseña.' });
  }
  if (username.length < 3) {
    return sendJSON(res, 400, { error: 'El usuario debe tener al menos 3 caracteres.' });
  }
  if (password.length < 6) {
    return sendJSON(res, 400, { error: 'La contraseña debe tener al menos 6 caracteres.' });
  }
  if (db.findUserByUsername(username)) {
    return sendJSON(res, 409, { error: 'Ese usuario ya existe.' });
  }

  const { hash, salt } = auth.hashPassword(password);
  const user = {
    id: crypto.randomUUID(),
    username,
    displayName: displayName || username,
    passwordHash: hash,
    passwordSalt: salt,
    createdAt: Date.now(),
  };
  db.createUser(user);

  const token = auth.createToken(user.id);
  return sendJSON(res, 201, { token, user: publicUser(user) });
}

async function handleLogin(req, res) {
  const { username, password } = await readBody(req);

  const user = db.findUserByUsername(username);
  if (!user || !auth.verifyPassword(password, user.passwordSalt, user.passwordHash)) {
    return sendJSON(res, 401, { error: 'Usuario o contraseña incorrectos.' });
  }

  const token = auth.createToken(user.id);
  return sendJSON(res, 200, { token, user: publicUser(user) });
}

async function handleMe(req, res) {
  const token = getTokenFromRequest(req);
  const userId = auth.getUserIdFromToken(token);
  if (!userId) return sendJSON(res, 401, { error: 'No autenticado.' });

  const user = db.findUserById(userId);
  return sendJSON(res, 200, { user: publicUser(user) });
}

async function handleContacts(req, res) {
  const token = getTokenFromRequest(req);
  const userId = auth.getUserIdFromToken(token);
  if (!userId) return sendJSON(res, 401, { error: 'No autenticado.' });

  // Por ahora: "contactos" = todos los demás usuarios registrados.
  // Más adelante se puede convertir en una lista real de amigos agregados.
  const others = db.getAllUsers()
    .filter(u => u.id !== userId)
    .map(publicUser);

  return sendJSON(res, 200, { contacts: others });
}

async function handleHistory(req, res, otherUserId) {
  const token = getTokenFromRequest(req);
  const userId = auth.getUserIdFromToken(token);
  if (!userId) return sendJSON(res, 401, { error: 'No autenticado.' });

  const conversation = db.getConversation(userId, otherUserId);
  return sendJSON(res, 200, { messages: conversation });
}

// ---------- Servidor HTTP ----------

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    return sendJSON(res, 204, {});
  }

  const url = new URL(req.url, `http://${req.headers.host}`);

  try {
    if (req.method === 'POST' && url.pathname === '/api/register') {
      return await handleRegister(req, res);
    }
    if (req.method === 'POST' && url.pathname === '/api/login') {
      return await handleLogin(req, res);
    }
    if (req.method === 'GET' && url.pathname === '/api/me') {
      return await handleMe(req, res);
    }
    if (req.method === 'GET' && url.pathname === '/api/contacts') {
      return await handleContacts(req, res);
    }
    if (req.method === 'GET' && url.pathname.startsWith('/api/history/')) {
      const otherUserId = url.pathname.split('/api/history/')[1];
      return await handleHistory(req, res, otherUserId);
    }
    if (req.method === 'GET' && url.pathname === '/api/health') {
      return sendJSON(res, 200, { status: 'ok' });
    }

    return sendJSON(res, 404, { error: 'Ruta no encontrada.' });
  } catch (err) {
    console.error(err);
    return sendJSON(res, 500, { error: 'Error interno del servidor.' });
  }
});

// ---------- WebSocket: chat en tiempo real ----------

const wss = new WebSocketServer({ server, path: '/ws' });

// Mapa de usuarios conectados: userId -> socket
const onlineUsers = new Map();

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const token = url.searchParams.get('token');
  const userId = auth.getUserIdFromToken(token);

  if (!userId) {
    ws.close(4001, 'No autenticado');
    return;
  }

  onlineUsers.set(userId, ws);
  broadcastPresence();

  ws.on('message', raw => {
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return; // Ignora mensajes mal formados.
    }

    if (data.type === 'chat_message') {
      const message = {
        id: crypto.randomUUID(),
        from: userId,
        to: data.to,
        text: String(data.text).slice(0, 4000), // límite razonable
        timestamp: Date.now(),
      };
      db.addMessage(message);

      // Entrega al destinatario si está conectado.
      const recipientSocket = onlineUsers.get(data.to);
      if (recipientSocket && recipientSocket.readyState === recipientSocket.OPEN) {
        recipientSocket.send(JSON.stringify({ type: 'chat_message', message }));
      }
      // Eco al remitente para confirmar entrega/orden.
      ws.send(JSON.stringify({ type: 'chat_message_sent', message }));
    }

    if (data.type === 'typing') {
      const recipientSocket = onlineUsers.get(data.to);
      if (recipientSocket && recipientSocket.readyState === recipientSocket.OPEN) {
        recipientSocket.send(JSON.stringify({ type: 'typing', from: userId }));
      }
    }
  });

  ws.on('close', () => {
    onlineUsers.delete(userId);
    broadcastPresence();
  });
});

function broadcastPresence() {
  const onlineIds = Array.from(onlineUsers.keys());
  const payload = JSON.stringify({ type: 'presence', online: onlineIds });
  for (const socket of onlineUsers.values()) {
    if (socket.readyState === socket.OPEN) socket.send(payload);
  }
}

server.listen(PORT, () => {
  console.log(`Servidor de Friends escuchando en el puerto ${PORT}`);
});
