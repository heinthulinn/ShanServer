const { calculateShanResult } = require("./gameHelpers");

function formatCards(cards) {
  if (!Array.isArray(cards)) return [];
  const suitMap = { 4: "S", 3: "H", 2: "D", 1: "C" };

  return cards
    .map(card => {
      if (!card) return null;
      if (typeof card === "string") return card;
      if (typeof card.rank !== "number" || typeof card.suit !== "number") return null;
      return `${card.rank}${suitMap[card.suit] || ""}`;
    })
    .filter(Boolean);
}

function getPhase(table) {
  if (!table?.roundInProgress) return "idle";
  if (table.waitingForNextRound || table.payoutTimer) return "payout";
  if (table.isProcessingResult || table.findWinnerTimer) return "result";
  if (table.dealerActionTimer) return "draw";
  if (table.watchTimer) return "watch";
  if (table.dealAckReceived === false && table.roundId > 0) return "deal";
  if (table.betInterval) return "betting";
  if (table.countdownInterval || table.countdown > 0) return "countdown";
  return "in_round";
}

function buildGameStateSnapshot(table) {
  return {
    type: "game:state:snapshot",
    tableId: table.tableId,
    roundId: table.roundId || 0,
    phase: getPhase(table),
    gameInProgress: !!table.gameInProgress,
    joinLocked: !!table.joinLockedForRound,
    players: table.players.map(player => {
      const cards = formatCards(player.cards);
      let points = 0;
      let multiplier = 1;

      if (cards.length >= 2) {
        try {
          const result = calculateShanResult(player.cards);
          points = result.points;
          multiplier = result.multiplier;
        } catch (_) {
          points = 0;
          multiplier = 1;
        }
      }

      return {
        seatId: player.seatId,
        username: player.username,
        waiting: !!player.waiting,
        leaveAfterRound: !!player.leaveAfterRound,
        isDealer: !!player.isDealer,
        cards,
        points,
        currentBet: Number(player.currentBet) || 0,
        balance: Number(player.balance) || 0,
        multiplier
      };
    })
  };
}

module.exports = {
  buildGameStateSnapshot
};
