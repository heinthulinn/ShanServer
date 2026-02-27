// ===== social/emojiHandler.js =====
const { tables } = require("../state/tables");
const { broadcastToTable } = require("../ws/sender");

function handleSocialEmoji(ws, data) {
  const { tableId, fromSeat, emojiId } = data;

  const table = tables[tableId];
  if (!table) return;

 // if (table.phase !== "PLAYER_MESSAGE") return;

  const sender = table.players.find(p => p.seatId === fromSeat);
  if (!sender) return;

  if (typeof emojiId !== "number") return;

  console.log(
    `😄 SOCIAL EMOJI | ${sender.username}(${fromSeat}) emoji=${emojiId}`
  );

  broadcastToTable(tableId, {
    type: "social:emoji",
    fromSeat,
    emojiId
  });
}

module.exports = {
  handleSocialEmoji
};
