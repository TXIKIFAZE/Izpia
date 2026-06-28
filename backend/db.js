// db.js
// Base de datos simple basada en un archivo JSON.
// Suficiente para empezar; cuando el proyecto crezca se puede migrar
// a SQLite o Postgres sin cambiar la forma en que el resto del código
// llama a estas funciones.

const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, 'data.json');

function loadData() {
  if (!fs.existsSync(DB_FILE)) {
    const initial = { users: [], messages: [] };
    fs.writeFileSync(DB_FILE, JSON.stringify(initial, null, 2));
    return initial;
  }
  const raw = fs.readFileSync(DB_FILE, 'utf-8');
  return JSON.parse(raw);
}

function saveData(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

let data = loadData();

function persist() {
  saveData(data);
}

// ---- Usuarios ----

function findUserByUsername(username) {
  return data.users.find(u => u.username === username);
}

function findUserById(id) {
  return data.users.find(u => u.id === id);
}

function createUser(user) {
  data.users.push(user);
  persist();
  return user;
}

function getAllUsers() {
  return data.users;
}

// ---- Mensajes ----

function addMessage(message) {
  data.messages.push(message);
  persist();
  return message;
}

// Devuelve la conversación entre dos usuarios, ordenada por fecha.
function getConversation(userIdA, userIdB) {
  return data.messages
    .filter(m =>
      (m.from === userIdA && m.to === userIdB) ||
      (m.from === userIdB && m.to === userIdA)
    )
    .sort((a, b) => a.timestamp - b.timestamp);
}

module.exports = {
  findUserByUsername,
  findUserById,
  createUser,
  getAllUsers,
  addMessage,
  getConversation,
};

