// ===== social/messageHandler.js =====
const { tables } = require("../state/tables");
const { broadcastToTable } = require("../ws/sender");

function handlePlayerMessage(ws, data) {
  const { tableId, fromSeat, message } = data;

  const table = tables[tableId];
  if (!table) return;

  // optional but strongly recommended
 // if (table.phase !== "PLAYER_MESSAGE") return;

  const sender = table.players.find(p => p.seatId === fromSeat);
  if (!sender) return;

  // basic protection
  if (typeof message !== "string") return;
  if (message.length === 0 || message.length > 100) return;

  console.log(
    `💬 PLAYER MESSAGE | ${sender.username}(${fromSeat}): ${message}`
  );

  // 🔁 RELAY TO ALL PLAYERS AT TABLE
  broadcastToTable(tableId, {
    type: "social:message",
    fromSeat,
    message
  });
}

module.exports = {
  handlePlayerMessage
};
