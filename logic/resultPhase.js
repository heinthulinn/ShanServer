// ===== resultPhase.js =====
const { tables } = require("../state/tables");
const { broadcastToTable } = require("../ws/sender");
const { payoutWinners } = require("./payout");
const gameHelpers = require("./gameHelpers");

function startFindWinnerPhase(tableId, roundId, scheduleNextRound) {
    const table = tables[tableId];
    if (!table) return;

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
        findWinnerTime--;

        if (findWinnerTime <= 0) {
            clearInterval(table.findWinnerTimer);
            table.findWinnerTimer = null;
            const activePlayers = table.players.filter(p => !p.waiting);
            const dealer = activePlayers.find(p => p.isDealer);
            if (!dealer) 
            {
                table.isProcessingResult = null;
                return;
            }
            const winnerPlayers = gameHelpers.decideDealerWinners(activePlayers);
            table.currentWinners = winnerPlayers.map(p => p.username);

            const tableResult = gameHelpers.buildTableResult(table);

            broadcastToTable(tableId, {
                type: "game:round:result",
                ...tableResult
            });

            startPayoutPhase(tableId, roundId, scheduleNextRound);
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

function startPayoutPhase(tableId, roundId, scheduleNextRound) {
    const table = tables[tableId];
    if (!table) return;

    // 🔥 FIND THE DEALER SEAT HERE
    const dealer = table.players.find(p => p.isDealer);
    const dealerSeatId = dealer ? dealer.seatId : -1;

    // 1. Calculate the final numbers
    const payoutResults = payoutWinners(table, table.players, table.currentWinners);

    // --- PHASE 1: COLLECT FROM LOSERS ---
    // We send only the players where resultAmount <= 0
    const losers = payoutResults.filter(r => r.resultAmount <= 0);
    broadcastToTable(tableId, { 
        type: "game:payout:collect", 
        roundId, 
        dealerSeatId: dealerSeatId, // 🔥 Send explicitly to Unity
        losers 
    });

    // Wait 2.5 seconds (adjust based on your chip animation speed)
    setTimeout(() => {
        
        // --- PHASE 2: PAY TO WINNERS ---
        // We send only the players where resultAmount > 0
        const winners = payoutResults.filter(r => r.resultAmount > 0);
        broadcastToTable(tableId, { 
            type: "game:payout:pay", 
            roundId, 
            dealerSeatId: dealerSeatId, // 🔥 Send explicitly to Unity
            winners 
        });

        // Final Wait before ending the round
        setTimeout(() => {
            broadcastToTable(tableId, { type: "game:payout:end", roundId });
            table.isProcessingResult = null; // Clear lock
            scheduleNextRound(tableId);
        }, 3000);

    }, 2500); 
}

module.exports = {
    startFindWinnerPhase
};
