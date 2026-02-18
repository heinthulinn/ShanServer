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

function executeDealerAction(tableId, roundId, action, startFindWinnerPhase, targetSeatId) {
    const table = tables[tableId];
    const dealer = table.players.find(p => p.isDealer);
    if (!table || !dealer) return;

    if (dealer.hasDrawn === undefined) dealer.hasDrawn = false;
    console.log(`👑 [DEALER ACTION EXECUTE] ${action}`);

    // Helper to convert card objects {rank, suit} to strings "10S"
    const mapCardsToStrings = (cards) => {
        if (!cards) return [];
        const suitMap = { 4: "S", 3: "H", 2: "D", 1: "C" };
        return cards.map(c => typeof c === 'string' ? c : `${c.rank}${suitMap[c.suit]}`);
    };

    switch (action) {
        case "catch":
            if (!targetSeatId) return;
            const targetPlayer = table.players.find(p => p.seatId === targetSeatId);
            if (!targetPlayer) return;

            broadcastToTable(tableId, {
                type: "table:cards:reveal",
                players: [{
                    username: targetPlayer.username,
                    seatId: targetPlayer.seatId,
                    cards: mapCardsToStrings(targetPlayer.cards) // 🔥 FIXED
                }]
            });

            broadcastToTable(tableId, {
                type: "ui:dealercatchcardview:show",
                dealer: { seatId: dealer.seatId, cards: mapCardsToStrings(dealer.cards) }, // 🔥 FIXED
                targetPlayer: { seatId: targetPlayer.seatId, cards: mapCardsToStrings(targetPlayer.cards) }, // 🔥 FIXED
                roundId
            });
            break;

        case "catch3cards":
            const threeCardPlayers = table.players.filter(p => p.cards && p.cards.length === 3);
            
            broadcastToTable(tableId, {
                type: "table:cards:reveal",
                players: threeCardPlayers.map(p => ({
                    username: p.username,
                    seatId: p.seatId,
                    cards: mapCardsToStrings(p.cards) // 🔥 FIXED
                }))
            });

            broadcastToTable(tableId, {
                type: "ui:dealercatchcardview:show",
                dealer: { seatId: dealer.seatId, cards: mapCardsToStrings(dealer.cards) }, // 🔥 FIXED
                players: threeCardPlayers.map(p => ({ seatId: p.seatId, cards: mapCardsToStrings(p.cards) })), // 🔥 FIXED
                roundId
            });
            break;

        case "catchall":
            const allOpponents = table.players.filter(p => !p.isDealer);

            broadcastToTable(tableId, {
                type: "table:cards:reveal",
                players: allOpponents.map(p => ({
                    username: p.username,
                    seatId: p.seatId,
                    cards: mapCardsToStrings(p.cards) // 🔥 FIXED
                }))
            });

            broadcastToTable(tableId, {
                type: "ui:dealercatchcardview:show",
                dealer: { seatId: dealer.seatId, cards: mapCardsToStrings(dealer.cards) }, // 🔥 FIXED
                players: allOpponents.map(p => ({ seatId: p.seatId, cards: mapCardsToStrings(p.cards) })), // 🔥 FIXED
                roundId
            });
            break;

        case "draw":
            if (!dealer.hasDrawn && dealer.cards.length === 2) {
                dealer.hasDrawn = true;
                const card = table.deck[table.deckIndex++];
                dealer.cards.push(card);
                const cardName = `${card.rank}${{4:"S",3:"H",2:"D",1:"C"}[card.suit]}`;
                broadcastToTable(tableId, { type: "game:dealer:draw", card: cardName, roundId });
                setTimeout(() => startFindWinnerPhase(tableId, roundId), 1500);
            }
            return;

        case "skip":
        default:
            startFindWinnerPhase(tableId, roundId);
            return;
    }

    // Timer for Catch/Reveal cases
    setTimeout(() => {
        broadcastToTable(tableId, { type: "ui:dealercatchcardview:hide", roundId });
        startFindWinnerPhase(tableId, roundId);
    }, 5000);
}

module.exports = {
    startDealerActionPhase,
    handleDealerDecision
};
