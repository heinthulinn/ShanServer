// ===== resultPhase.js =====
const { tables } = require("../state/tables");
const { broadcastToTable } = require("../ws/sender");
const WebSocket = require("ws");
const { payoutWinners } = require("./payout");
const gameHelpers = require("./gameHelpers");
const { abortRoundIfNoConnectedRealPlayers, isRoundContextValid } = require("./roundSafety");

function startFindWinnerPhase(tableId, roundId, scheduleNextRound) {
    const table = tables[tableId];
    if (!table) return;
    if (abortRoundIfNoConnectedRealPlayers(table, "resultPhase:start")) return;
    const phaseToken = Number(table.roundAbortToken) || 0;

    // 🔒 PHASE LOCK: Prevent multiple triggers for the same round
    if (table.isProcessingResult === roundId) {
        console.log(`⚠️ Blocked duplicate winner phase for Round: ${roundId}`);
        return;
    }
    table.isProcessingResult = roundId;

    let findWinnerTime = 5;
    broadcastToTable(tableId, {
        type: "game:findwinner:start",
        seconds: findWinnerTime,
        roundId
    });

    table.findWinnerTimer = setInterval(() => {
        if (!isRoundContextValid(table, roundId, phaseToken, "resultPhase:tick")) {
            clearInterval(table.findWinnerTimer);
            table.findWinnerTimer = null;
            return;
        }
        findWinnerTime--;

        if (findWinnerTime <= 0) {
            clearInterval(table.findWinnerTimer);
            table.findWinnerTimer = null;
            const activePlayers = table.players
                .filter(p => !p.waiting)
                .filter(p => p.isAi || (p.ws && p.ws.readyState === WebSocket.OPEN));
            const dealer = activePlayers.find(p => p.isDealer);
            if (!dealer) {
                console.error(`❌ No dealer found at result phase on ${tableId}, forcing next round`);
                table.isProcessingResult = null;
                scheduleNextRound(tableId);
                return;
            }
            const winnerPlayers = gameHelpers.decideDealerWinners(activePlayers);
            table.currentWinners = winnerPlayers.map(p => p.username);

            const tableResult = gameHelpers.buildTableResult({
                ...table,
                players: activePlayers
            });

            broadcastToTable(tableId, {
                type: "game:round:result",
                ...tableResult
            });

            startPayoutPhase(tableId, roundId, scheduleNextRound, phaseToken);
        }
        else {
            broadcastToTable(tableId, {
                type: "game:findwinner:tick",
                seconds: findWinnerTime,
                roundId
            });
        }
    }, 1000);
}

function startPayoutPhase(tableId, roundId, scheduleNextRound, parentToken) {
    const table = tables[tableId];
    if (!table) return;
    if (abortRoundIfNoConnectedRealPlayers(table, "resultPhase:payout-start")) return;
    const phaseToken = typeof parentToken === "number"
        ? parentToken
        : (Number(table.roundAbortToken) || 0);

    // 🔥 FIND THE DEALER SEAT HERE
    const dealer = table.players.find(p => p.isDealer);
    const dealerSeatId = dealer ? dealer.seatId : -1;

    // 1. Calculate the final numbers
    const payoutPlayers = table.players.filter(
        p => p.isDealer || p.isAi || (p.ws && p.ws.readyState === WebSocket.OPEN)
    );
    const payoutResults = payoutWinners(table, payoutPlayers, table.currentWinners);

    // --- PHASE 1: COLLECT FROM LOSERS ---
    // Change r.resultAmount to r.delta. Also exclude dealer.
    const losers = payoutResults.filter(r => r.resultAmount < 0 && !r.isDealer);
    broadcastToTable(tableId, {
        type: "game:payout:collect",
        roundId,
        dealerSeatId: dealerSeatId, // 🔥 Send explicitly to Unity
        losers
    });

    // Wait 2.5 seconds (adjust based on your chip animation speed)
    setTimeout(() => {
        if (!isRoundContextValid(table, roundId, phaseToken, "resultPhase:payout-pay")) return;

        // --- PHASE 2: PAY TO WINNERS ---
        // Change r.resultAmount to r.delta. Also exclude dealer.
        const winners = payoutResults.filter(r => r.resultAmount > 0 && !r.isDealer);
        broadcastToTable(tableId, {
            type: "game:payout:pay",
            roundId,
            dealerSeatId: dealerSeatId, // 🔥 Send explicitly to Unity
            winners
        });

        // Final Wait before ending the round
        setTimeout(() => {
            if (!isRoundContextValid(table, roundId, phaseToken, "resultPhase:payout-end")) return;
            broadcastToTable(tableId, { type: "game:payout:end", roundId });
            table.isProcessingResult = null; // Clear lock
            scheduleNextRound(tableId);
        }, 3000);

    }, 2500);
}

module.exports = {
    startFindWinnerPhase
};
