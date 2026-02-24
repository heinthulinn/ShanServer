// ===== watchPhase.js =====
const { tables } = require("../state/tables");
const { broadcastToTable, safeWsSend } = require("../ws/sender");

function startWatchTwoCardPhase(tableId, roundId, onComplete) {
    const table = tables[tableId];
    if (!table) return;

    broadcastToTable(tableId, { type: "ui:cardview:show", roundId });

    let remainingWatch = 7;

    broadcastToTable(tableId, {
        type: "game:watch2card:start",
        seconds: remainingWatch,
        roundId
    });

    table.watchTimer = setInterval(() => {
        remainingWatch--;

        if (remainingWatch <= 0) {
            clearInterval(table.watchTimer);
            table.watchTimer = null;

            broadcastToTable(tableId, {
                type: "game:watch2card:end",
                roundId
            });

            broadcastToTable(tableId, {
                type: "ui:cardview:hide",
                roundId
            });

            if (onComplete) onComplete();

        } else {
            broadcastToTable(tableId, {
                type: "game:watch2card:tick",
                seconds: remainingWatch,
                roundId
            });
        }
    }, 1000);
}

function startWatchThreeCardPhase(tableId, roundId, onComplete) {
    const table = tables[tableId];
    if (!table) return;

    let secondWatchTime = 7;

    // 🔥 DELAY BEFORE SHOWING CARD VIEW
    setTimeout(() => {

        // 🔥 SHOW CARD VIEW ONLY TO PLAYERS WITH 3 CARDS
        table.players.forEach(p => {
            if (p.cards && p.cards.length === 3) {
                const sent = safeWsSend(p.ws, {
                    type: "ui:cardview:show",
                    roundId
                });
                if (!sent) {
                    console.log(`[WS] skip closed socket for seat=${p.seatId} username=${p.username} during watch3 show`);
                }
            }
        });

        broadcastToTable(tableId, {
            type: "game:watch3card:start",
            seconds: secondWatchTime,
            roundId
        });

        const timer = setInterval(() => {
            secondWatchTime--;

            if (secondWatchTime <= 0) {
                clearInterval(timer);

                broadcastToTable(tableId, {
                    type: "game:watch3card:end",
                    roundId
                });

                // 🔥 HIDE CARD VIEW ONLY FOR 3 CARD PLAYERS
                table.players.forEach(p => {
                    if (p.cards && p.cards.length === 3) {
                        const sent = safeWsSend(p.ws, {
                            type: "ui:cardview:hide",
                            roundId
                        });
                        if (!sent) {
                            console.log(`[WS] skip closed socket for seat=${p.seatId} username=${p.username} during watch3 hide`);
                        }
                    }
                });

                if (onComplete) onComplete();

            } else {
                broadcastToTable(tableId, {
                    type: "game:watch3card:tick",
                    seconds: secondWatchTime,
                    roundId
                });
            }
        }, 1000);

    }, 1500);
}



module.exports = {
    startWatchTwoCardPhase,
    startWatchThreeCardPhase
};
