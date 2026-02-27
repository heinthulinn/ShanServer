// ===== dealerPhase.js =====
const { tables } = require("../state/tables");
const { broadcastToTable, wsSend } = require("../ws/sender");
const WebSocket = require("ws");
const gameHelpers = require("./gameHelpers");
const { abortRoundIfNoConnectedRealPlayers, isRoundContextValid } = require("./roundSafety");

function startDealerActionPhase(tableId, roundId, startFindWinnerPhase) {
    const table = tables[tableId];
    if (!table) return;
    if (abortRoundIfNoConnectedRealPlayers(table, "dealerPhase:start")) return;
    const phaseToken = Number(table.roundAbortToken) || 0;
    const dealer = table.players.find(p => p.isDealer);
    if (!dealer) return;

    console.log(`👑 [DEALER ACTION START] Table:${tableId} | Round:${roundId}`);

    const threeCardPlayers = table.players
        .filter(p => p.cards && p.cards.length === 3)
        .filter(p => p.isAi || (p.ws && p.ws.readyState === WebSocket.OPEN))
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
            if (!isRoundContextValid(table, roundId, phaseToken, "dealerPhase:aiAction")) return;
            runAIDealerAction(tableId, roundId, startFindWinnerPhase);
        }, 1500);
        return;
    }

    // 👤 HUMAN DEALER TIMER
    let timeLeft = 10;
    table.dealerActionTimer = setInterval(() => {
        if (!isRoundContextValid(table, roundId, phaseToken, "dealerPhase:humanTick")) {
            clearInterval(table.dealerActionTimer);
            table.dealerActionTimer = null;
            return;
        }
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
    if (abortRoundIfNoConnectedRealPlayers(table, "dealerPhase:decision")) return;

    if (table.dealerActionTimer) {
        clearInterval(table.dealerActionTimer);
        table.dealerActionTimer = null;
    }

    console.log(`👑 [DEALER ACTION RECEIVED] ${action}`);
    executeDealerAction(tableId, table.roundId, action, startFindWinnerPhase,targetSeatId);
}

function runAIDealerAction(tableId, roundId, startFindWinnerPhase) {
    const table = tables[tableId];
    if (!table) return;
    if (abortRoundIfNoConnectedRealPlayers(table, "dealerPhase:runAi")) return;
    const dealer = table.players.find(p => p.isDealer);
    const dealerRes = gameHelpers.calculateShanResult(dealer.cards);

    const threeCardPlayers = table.players.filter(
        p => Array.isArray(p.cards) && p.cards.length === 3
    ).filter(
        p => p.isAi || (p.ws && p.ws.readyState === WebSocket.OPEN)
    );

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
    if (abortRoundIfNoConnectedRealPlayers(table, "dealerPhase:execute")) return;
    const phaseToken = Number(table.roundAbortToken) || 0;

    // --- NEW HELPER FOR CORRECT POINTS ---
    const prepareRevealData = (playerList) => {
        return playerList.map(p => {
            const result = gameHelpers.calculateShanResult(p.cards);
            return {
                username: p.username,
                seatId: p.seatId,
                cards: mapCardsToStrings(p.cards),
                points: result.points,      // 🔥 Added: Correct points for 2 or 3 cards
                multiplier: result.multiplier, // 🔥 Added: For x2, x3, etc.
                isShan: result.isDo         // 🔥 Added: In case Unity needs to show "Shan!"
            };
        });
    };

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
                players: prepareRevealData([targetPlayer]) // 🔥 Use the helper
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
            const connectedThreeCardPlayers = threeCardPlayers.filter(
                p => p.isAi || (p.ws && p.ws.readyState === WebSocket.OPEN)
            );
            
            broadcastToTable(tableId, {
                type: "table:cards:reveal",
                players: prepareRevealData(connectedThreeCardPlayers) // 🔥 Use the helper
            });

            broadcastToTable(tableId, {
                type: "ui:dealercatchcardview:show",
                dealer: { seatId: dealer.seatId, cards: mapCardsToStrings(dealer.cards) }, // 🔥 FIXED
                players: connectedThreeCardPlayers.map(p => ({ seatId: p.seatId, cards: mapCardsToStrings(p.cards) })), // 🔥 FIXED
                roundId
            });
            break;

        case "catchall":
            const allOpponents = table.players
                .filter(p => !p.isDealer)
                .filter(p => p.isAi || (p.ws && p.ws.readyState === WebSocket.OPEN));

            broadcastToTable(tableId, {
                type: "table:cards:reveal",
                players: prepareRevealData(allOpponents) // 🔥 Use the helper
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
                setTimeout(() => {
                    if (!isRoundContextValid(table, roundId, phaseToken, "dealerPhase:draw->result")) return;
                    startFindWinnerPhase(tableId, roundId);
                }, 1500);
            }
            return;

        case "skip":
        default:
            startFindWinnerPhase(tableId, roundId);
            return;
    }

    // Timer for Catch/Reveal cases
    setTimeout(() => {
        if (!isRoundContextValid(table, roundId, phaseToken, "dealerPhase:catch->result")) return;
        broadcastToTable(tableId, { type: "ui:dealercatchcardview:hide", roundId });
        startFindWinnerPhase(tableId, roundId);
    }, 5000);
}

module.exports = {
    startDealerActionPhase,
    handleDealerDecision
};
