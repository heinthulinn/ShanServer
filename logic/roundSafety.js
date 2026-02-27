const WebSocket = require("ws");
const { hardResetTable } = require("./roundReset");
const { broadcastToTable } = require("../ws/sender");

function countConnectedRealPlayers(table) {
  if (!table || !Array.isArray(table.players)) return 0;
  return table.players.filter(
    p => !p.isAi && p.ws && p.ws.readyState === WebSocket.OPEN
  ).length;
}

function clearRoundTimers(table) {
  if (!table) return;
  const timers = [
    table.countdownInterval,
    table.betInterval,
    table.watchTimer,
    table.dealerActionTimer,
    table.findWinnerTimer,
    table.payoutTimer,
    table.dealAckTimer
  ];

  timers.forEach((timer) => {
    if (!timer) return;
    clearInterval(timer);
    clearTimeout(timer);
  });

  table.countdownInterval = null;
  table.betInterval = null;
  table.watchTimer = null;
  table.dealerActionTimer = null;
  table.findWinnerTimer = null;
  table.payoutTimer = null;
  table.dealAckTimer = null;
  table.dealAckDeadlineAt = null;
}

function abortRoundIfNoConnectedRealPlayers(table, reason) {
  if (!table) return false;
  const connectedRealPlayers = countConnectedRealPlayers(table);
  if (connectedRealPlayers > 0) return false;

  const prevToken = Number(table.roundAbortToken) || 0;
  table.roundAbortToken = prevToken + 1;
  table.roundAborted = true;

  console.warn(
    `[ROUND_ABORT] reason=${reason} table=${table.tableId} round=${table.roundId} connected_real=0 token=${table.roundAbortToken}`
  );

  clearRoundTimers(table);
  hardResetTable(table);
  table.roundAborted = false;

  broadcastToTable(table.tableId, {
    type: "table:reset",
    tableId: table.tableId
  });
  return true;
}

function isRoundContextValid(table, expectedRoundId, expectedToken, context) {
  if (!table) {
    console.log(`[ROUND_GUARD] skip context=${context} reason=table_missing`);
    return false;
  }

  if (typeof expectedRoundId === "number" && table.roundId !== expectedRoundId) {
    console.log(
      `[ROUND_GUARD] skip context=${context} reason=round_changed expected=${expectedRoundId} actual=${table.roundId}`
    );
    return false;
  }

  const liveToken = Number(table.roundAbortToken) || 0;
  if (typeof expectedToken === "number" && liveToken !== expectedToken) {
    console.log(
      `[ROUND_GUARD] skip context=${context} reason=token_changed expected=${expectedToken} actual=${liveToken}`
    );
    return false;
  }

  if (abortRoundIfNoConnectedRealPlayers(table, `callback_guard:${context}`)) {
    return false;
  }

  return true;
}

module.exports = {
  countConnectedRealPlayers,
  abortRoundIfNoConnectedRealPlayers,
  isRoundContextValid
};
