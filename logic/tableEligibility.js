const { wsSend } = require("../ws/sender");
const {
  replaceAiAtSeat,
  clearDealerSessionForRemovedPlayer
} = require("./tableHelpers");
const { syncRealPlayerBalance } = require("./balanceAuthority");

function enforcePreRoundBalanceEligibility(table) {
  if (!table) {
    return { changed: false, removedRealUsers: [], replacedAiPlayers: [] };
  }

  const minBuyIn = Number(table.minBuyIn) || 0;
  const survivors = [];
  const removedRealUsers = [];
  const aiSeatsToReplace = [];

  table.players.forEach((player) => {
    const balance = Number(player.balance) || 0;
    if (balance >= minBuyIn) {
      survivors.push(player);
      return;
    }

    clearDealerSessionForRemovedPlayer(
      table,
      player,
      player.isAi ? "insufficient_balance_ai" : "insufficient_balance_real"
    );

    if (player.isAi) {
      aiSeatsToReplace.push(player.seatId);
      console.log(
        `[BALANCE_SWEEP] replace_ai table=${table.tableId} seat=${player.seatId} balance=${balance} minBuyIn=${minBuyIn}`
      );
      return;
    }

    wsSend(player.ws, {
      type: "tables:leave:forced",
      tableId: table.tableId,
      username: player.username,
      reason: "insufficient_balance",
      balance,
      minBuyIn
    });

    if (player.ws) {
      player.ws.tableId = null;
      player.ws.username = null;
      player.ws = null;
    }

    syncRealPlayerBalance(player.username, balance);
    removedRealUsers.push({
      username: player.username,
      seatId: player.seatId,
      balance
    });
    console.log(
      `[BALANCE_SWEEP] remove_real table=${table.tableId} user=${player.username} seat=${player.seatId} balance=${balance} minBuyIn=${minBuyIn}`
    );
  });

  table.players = survivors;

  const replacedAiPlayers = [];
  aiSeatsToReplace
    .sort((leftSeat, rightSeat) => leftSeat - rightSeat)
    .forEach((seatId) => {
      const replacement = replaceAiAtSeat(table, seatId);
      if (!replacement) return;
      replacedAiPlayers.push({
        seatId: replacement.seatId,
        username: replacement.username,
        balance: replacement.balance
      });
    });

  return {
    changed: removedRealUsers.length > 0 || replacedAiPlayers.length > 0,
    removedRealUsers,
    replacedAiPlayers
  };
}

module.exports = {
  enforcePreRoundBalanceEligibility
};
