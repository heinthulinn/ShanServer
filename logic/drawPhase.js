// ===== drawPhase.js =====
const { tables } = require("../state/tables");
const { broadcastToTable } = require("../ws/sender");
const WebSocket = require("ws");
const gameHelpers = require("./gameHelpers");
const watchPhase = require("./watchPhase");
const dealerPhase = require("./dealerPhase");
const { abortRoundIfNoConnectedRealPlayers, isRoundContextValid } = require("./roundSafety");

function processFinalDraws(tableId, roundId, startFindWinnerPhase) {
    const table = tables[tableId];
    if (!table) return;
    if (abortRoundIfNoConnectedRealPlayers(table, "drawPhase:start")) return;
    const phaseToken = Number(table.roundAbortToken) || 0;

    let anyoneDrew = false;

    console.log(`--- [DRAW PHASE START] Table: ${tableId} ---`);

    // ===============================
    // 👑 DEALER AUTO DRAW
    // ===============================
    const dealer = table.players.find(p => p.isDealer);
    if (dealer) {
        const dealerRes = gameHelpers.calculateShanResult(dealer.cards);

        if (
            dealer.cards.length === 2 &&
            dealerRes.points < 4 &&
            !dealer.hasDrawn
        ) {
            const card = table.deck[table.deckIndex++];
            dealer.cards.push(card);
            dealer.hasDrawn = true;
            anyoneDrew = true;

            const cardName = `${card.rank}${{4:"S",3:"H",2:"D",1:"C"}[card.suit]}`;

            broadcastToTable(tableId, {
                type: "game:dealer:auto_draw",
                card: cardName,
                roundId
            });
        }
    }

    // ===============================
    // 👤 PLAYER DRAW LOGIC
    // ===============================
    table.players.forEach(p => {
        if (p.waiting || p.isDealer) return;
        if (!p.isAi && (!p.ws || p.ws.readyState !== WebSocket.OPEN)) return;

        const res = gameHelpers.calculateShanResult(p.cards);
        if (res.points >= 8) return;

        if (p.isAi && res.points < 4) p.drawAction = "draw";

        if (p.drawAction === "draw" || (!p.drawAction && res.points < 4)) {
            if (p.cards.length === 2) {
                const card = table.deck[table.deckIndex++];
                p.cards.push(card);
                anyoneDrew = true;

                const cardName = `${card.rank}${{4:"S",3:"H",2:"D",1:"C"}[card.suit]}`;

                broadcastToTable(tableId, {
                    type: "game:player:draw",
                    username: p.username,
                    card: cardName
                });
            }
        }
    });

    // ===============================
    // NEXT PHASE
    // ===============================
    if (anyoneDrew) {
        watchPhase.startWatchThreeCardPhase(tableId, roundId, () => {
            if (!isRoundContextValid(table, roundId, phaseToken, "drawPhase:watch3->dealerAction")) return;
            dealerPhase.startDealerActionPhase(
                tableId,
                roundId,
                startFindWinnerPhase
            );
        });
    } else {
        if (!isRoundContextValid(table, roundId, phaseToken, "drawPhase:directResult")) return;
        startFindWinnerPhase(tableId, roundId);
    }
}

module.exports = {
    processFinalDraws
};
