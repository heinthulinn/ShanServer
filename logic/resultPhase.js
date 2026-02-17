// ===== resultPhase.js =====
const { tables } = require("../state/tables");
const { broadcastToTable } = require("../ws/sender");
const { payoutWinners } = require("./payout");
const gameHelpers = require("./gameHelpers");

function startFindWinnerPhase(tableId, roundId, scheduleNextRound) {
    const table = tables[tableId];
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

            const activePlayers = table.players.filter(p => !p.waiting);
            const dealer = activePlayers.find(p => p.isDealer);
            if (!dealer) return;

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
    let payoutTime = 5;

    const payoutResults = payoutWinners(
        table,
        table.players,
        table.currentWinners
    );

    broadcastToTable(tableId, { 
        type: "game:payout:result", 
        roundId, 
        results: payoutResults 
    });

    table.payoutTimer = setInterval(() => {
        payoutTime--;

        if (payoutTime <= 0) {
            clearInterval(table.payoutTimer);

            broadcastToTable(tableId, { 
                type: "game:payout:end", 
                roundId 
            });

            scheduleNextRound(tableId);
        } 
        else {
            broadcastToTable(tableId, { 
                type: "game:payout:tick", 
                seconds: payoutTime, 
                roundId 
            });
        }
    }, 1000);
}

module.exports = {
    startFindWinnerPhase
};
