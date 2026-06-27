// auth.js
// Autenticación simple: contraseñas hasheadas con el módulo nativo
// 'crypto' (sin dependencias externas) y tokens de sesión aleatorios
// guardados en memoria.

const crypto = require('crypto');

// --- Hashing de contraseñas (PBKDF2, nativo de Node) ---

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto
    .pbkdf2Sync(password, salt, 100000, 64, 'sha512')
    .toString('hex');
  return { hash, salt };
}

function verifyPassword(password, salt, expectedHash) {
  const { hash } = hashPassword(password, salt);
  return hash === expectedHash;
}

// --- Tokens de sesión ---
// Mapa en memoria: token -> userId
// (si el servidor se reinicia, los usuarios deben volver a iniciar sesión)

const sessions = new Map();

function createToken(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, userId);
  return token;
}

function getUserIdFromToken(token) {
  return sessions.get(token) || null;
}

function revokeToken(token) {
  sessions.delete(token);
}

module.exports = {
  hashPassword,
  verifyPassword,
  createToken,
  getUserIdFromToken,
  revokeToken,
};
