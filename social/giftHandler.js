// ===== social/giftHandler.js =====
const { tables } = require("../state/tables");
const { broadcastToTable } = require("../ws/sender");

function handleSocialGift(ws, data) {
  const { tableId, fromSeat, toSeat, giftIndex } = data;

  const table = tables[tableId];
  if (!table) return;

  const sender = table.players.find(p => p.seatId === fromSeat);
  const receiver = table.players.find(p => p.seatId === toSeat);

  if (!sender || !receiver) return;
  if (fromSeat === toSeat) return;

  console.log(
    `🎁 SOCIAL GIFT | ${sender.username}(${fromSeat}) → ${receiver.username}(${toSeat}) | gift=${giftIndex}`
  );

  // 🔁 RELAY TO ALL PLAYERS AT TABLE
  broadcastToTable(tableId, {
    type: "social:gift",
    fromSeat,
    toSeat,
    giftIndex
  });
}

module.exports = {
  handleSocialGift
};
