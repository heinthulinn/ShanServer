// ===== watchPhase.js =====
const { tables } = require("../state/tables");
const { broadcastToTable, wsSend } = require("../ws/sender");

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

    // 🔥 ADD DELAY BEFORE SHOWING CARD VIEW
    setTimeout(() => {

        broadcastToTable(tableId, { type: "ui:cardview:show", roundId });

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

                broadcastToTable(tableId, {
                    type: "ui:cardview:hide",
                    roundId
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

    }, 1500); // 👈 change delay here if you want
}


module.exports = {
    startWatchTwoCardPhase,
    startWatchThreeCardPhase
};
