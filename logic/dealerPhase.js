// ===== dealerPhase.js =====
const { tables } = require("../state/tables");
const { broadcastToTable, wsSend } = require("../ws/sender");
const gameHelpers = require("./gameHelpers");

function startDealerActionPhase(tableId, roundId, startFindWinnerPhase) {
    const table = tables[tableId];
    const dealer = table.players.find(p => p.isDealer);

    console.log(`👑 [DEALER ACTION START] Table:${tableId} | Round:${roundId}`);

    const threeCardPlayers = table.players
        .filter(p => p.cards && p.cards.length === 3)
        .sort((a, b) => a.seatId - b.seatId);

    broadcastToTable(tableId, {
        type: "game:dealer:action:start",
        roundId,
        seconds: 10,
        threeCardPlayers: threeCardPlayers.map(p => ({
            username: p.username,
            seatId: p.seatId
        }))
    });

    // 🤖 AI DEALER
    if (dealer.isAi) {
        setTimeout(() => {
            runAIDealerAction(tableId, roundId, startFindWinnerPhase);
        }, 1500);
        return;
    }

    // 👤 HUMAN DEALER TIMER
    let timeLeft = 10;
    table.dealerActionTimer = setInterval(() => {
        timeLeft--;

        if (timeLeft <= 0) {
            clearInterval(table.dealerActionTimer);
            table.dealerActionTimer = null;

            console.log(`⏱️ [DEALER TIMEOUT] AUTO SKIP`);
            executeDealerAction(tableId, roundId, "skip", startFindWinnerPhase);
        } else {
            broadcastToTable(tableId, {
                type: "game:dealer:action:tick",
                seconds: timeLeft,
                roundId
            });
        }
    }, 1000);
}

function handleDealerDecision(ws, data, startFindWinnerPhase) {
    const { tableId, action} = data;
    const targetSeatId = data.targetSeatId || data.seatId;
    console.log(`👑 [DEALER ACTION RECEIVED] ${action} on Seat: ${targetSeatId}`);
    const table = tables[tableId];
    if (!table) return;

    if (table.dealerActionTimer) {
        clearInterval(table.dealerActionTimer);
        table.dealerActionTimer = null;
    }

    console.log(`👑 [DEALER ACTION RECEIVED] ${action}`);
    executeDealerAction(tableId, table.roundId, action, startFindWinnerPhase,targetSeatId);
}

function runAIDealerAction(tableId, roundId, startFindWinnerPhase) {
    const table = tables[tableId];
    const dealer = table.players.find(p => p.isDealer);
    const dealerRes = gameHelpers.calculateShanResult(dealer.cards);

    const threeCardPlayers = table.players.filter(p => p.cards.length === 3);

    let action = "skip";

    if (dealerRes.points < 4 && dealer.cards.length === 2) {
        action = "draw";
    } else if (threeCardPlayers.length > 0) {
        action = "catch3cards";
    } else {
        action = "catchall";
    }

    console.log(`🤖👑 [AI DEALER ACTION] ${action}`);
    executeDealerAction(tableId, roundId, action, startFindWinnerPhase);
}

function executeDealerAction(tableId, roundId, action, startFindWinnerPhase,targetSeatId) 
{
    const table = tables[tableId];
    const dealer = table.players.find(p => p.isDealer);
    if (!dealer) return;

    if (dealer.hasDrawn === undefined) dealer.hasDrawn = false;

    console.log(`👑 [DEALER ACTION EXECUTE] ${action}`);

    switch (action) {
        case "catch":
            if (!targetSeatId) return;
            const targetPlayer = table.players.find(p => p.seatId === targetSeatId);
            if (!targetPlayer) return;

            // 🔥 REVEAL: Flip the cards on the table for this player
            broadcastToTable(tableId, {
                type: "table:cards:reveal",
                players: [{
                    username: targetPlayer.username,
                    seatId: targetPlayer.seatId,
                    cards: targetPlayer.cards
                }]
            });

            // 1️⃣ Show Dealer Catch UI (Keep this as is)
            broadcastToTable(tableId, {
                type: "ui:dealercatchcardview:show",
                dealer: { seatId: dealer.seatId, cards: dealer.cards },
                targetPlayer: { seatId: targetPlayer.seatId, cards: targetPlayer.cards },
                roundId
            });

            setTimeout(() => {
                broadcastToTable(tableId, { type: "ui:dealercatchcardview:hide", roundId });
                startFindWinnerPhase(tableId, roundId);
            }, 5000);
            return;

        case "catch3cards":
            const threeCardPlayers = table.players.filter(p => p.cards && p.cards.length === 3);

            // 🔥 REVEAL: Flip all 3-card players on the table
            broadcastToTable(tableId, {
                type: "table:cards:reveal",
                players: threeCardPlayers.map(p => ({
                    username: p.username,
                    seatId: p.seatId,
                    cards: p.cards
                }))
            });

            broadcastToTable(tableId, {
                type: "ui:dealercatchcardview:show",
                dealer: { seatId: dealer.seatId, cards: dealer.cards },
                players: threeCardPlayers.map(p => ({ seatId: p.seatId, cards: p.cards })),
                roundId
            });

            setTimeout(() => {
                broadcastToTable(tableId, { type: "ui:dealercatchcardview:hide", roundId });
                startFindWinnerPhase(tableId, roundId);
            }, 5000);
            return;

        case "catchall":
            const allOpponents = table.players.filter(p => !p.isDealer);

            // 🔥 REVEAL: Flip EVERYONE on the table
            broadcastToTable(tableId, {
                type: "table:cards:reveal",
                players: allOpponents.map(p => ({
                    username: p.username,
                    seatId: p.seatId,
                    cards: p.cards
                }))
            });

            broadcastToTable(tableId, {
                type: "ui:dealercatchcardview:show",
                dealer: { seatId: dealer.seatId, cards: dealer.cards },
                players: allOpponents.map(p => ({ seatId: p.seatId, cards: p.cards })),
                roundId
            });

            setTimeout(() => {
                broadcastToTable(tableId, { type: "ui:dealercatchcardview:hide", roundId });
                startFindWinnerPhase(tableId, roundId);
            }, 5000);
            return;

        case "draw":
            if (!dealer.hasDrawn && dealer.cards.length === 2) {
                dealer.hasDrawn = true;

                const card = table.deck[table.deckIndex++];
                dealer.cards.push(card);

                const cardName = `${card.rank}${{4:"S",3:"H",2:"D",1:"C"}[card.suit]}`;

                broadcastToTable(tableId, {
                    type: "game:dealer:draw",
                    card: cardName,
                    roundId
                });
            }
            break;

        case "skip":
        default:
            break;
    }

    setTimeout(() => {
        startFindWinnerPhase(tableId, roundId);
    }, 1500);
}

module.exports = {
    startDealerActionPhase,
    handleDealerDecision
};
