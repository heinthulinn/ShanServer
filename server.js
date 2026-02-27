// ===== server.js =====
const express = require("express");
const cors = require("cors");
const http = require("http");
const WebSocket = require("ws");
// WS helpers
const { initSender, wsSend, broadcastToTable } = require("./ws/sender");
// Users & AI
const { validUsers, aiPlayersList } = require("./state/users");
// Tables
const { tableTypes, tables } = require("./state/tables");
// Game logic
const { assignBaseAiFirst, getAvailableSeat } = require("./logic/tableHelpers");
const gameFlow = require("./logic/gameFlow");
const { startGame } = require("./logic/startGame");
const { leaveTable } = require("./logic/tableJoin");
const { hardResetTable } = require("./logic/roundReset");
const {
    countConnectedRealPlayers,
    abortRoundIfNoConnectedRealPlayers
} = require("./logic/roundSafety");
const { playerReady, handleGameResult } = require("./logic/gameHandlers");

// Hand evaluation / helpers
const gameHelpers = require("./logic/gameHelpers"); // includes calculateBuResult, decideDealerWinners, etc.

// Register game start
gameFlow.registerStartGame(startGame);

// ===== EXPRESS SERVER =====
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

const server = http.createServer(app);

// ===== WEBSOCKET SERVER =====
const wss = new WebSocket.Server({ server });
initSender(wss);

// ===== GLOBAL RTP CONFIG =====
const tablesRTP = {};
let nextSessionId = 1;

function hasStaleTableState(table) {
    return Boolean(
        table.roundInProgress ||
        table.gameInProgress ||
        table.joinLockedForRound ||
        table.waitingForNextRound ||
        table.dealAckReceived ||
        table.watchTimerStarted ||
        table.isProcessingResult ||
        table.autoStartCalled ||
        table.countdownInterval ||
        table.betInterval ||
        table.watchTimer ||
        table.findWinnerTimer ||
        table.payoutTimer ||
        table.currentWinners?.length
    );
}

function cleanupConnection(ws, reason) {
    if (!ws || ws._cleanedUp) return;
    ws._cleanedUp = true;

    const tableId = ws.tableId;
    const username = ws.username;

    if (tableId && username) {
        console.log(`❌ ${username} disconnected from ${tableId} (${reason})`);
        const table = tables[tableId];
        const connectedBefore = table ? countConnectedRealPlayers(table) : 0;
        if (table) {
            const player = table.players.find(p => p.username === username && !p.isAi);
            if (player) player.ws = null;
        }
        try {
            leaveTable(ws, { tableId, username, isDisconnect: true });
        } catch (error) {
            console.error(`❌ leaveTable crashed on ${reason} user=${username} table=${tableId}`, error);
        }
        const connectedAfter = table ? countConnectedRealPlayers(table) : 0;
        console.log(`[DISCONNECT] connected_real ${connectedBefore} -> ${connectedAfter} table=${tableId}`);
        if (table && connectedAfter === 0) {
            abortRoundIfNoConnectedRealPlayers(table, "last_real_disconnect");
        }
    }

    ws.tableId = null;
    ws.username = null;
    ws.isAlive = false;
}

// =========================
// WEBSOCKET CONNECTION
// =========================
wss.on("connection", (ws) => {
    console.log("🔌 WebSocket client connected!");
    ws.sessionId = nextSessionId++;
    ws.isAlive = true;
    ws.lastPongAt = Date.now();
    ws._cleanedUp = false;

    ws.send(JSON.stringify({ type: "connected", message: "Welcome!" }));

    const { handleWsMessage } = require("./ws/router");

    ws.on("message", (msg) => {
        handleWsMessage(ws, msg);
    });

    ws.on("pong", () => {
        ws.isAlive = true;
        ws.lastPongAt = Date.now();
    });

    ws.on("close", () => {
        cleanupConnection(ws, "close");
    });

    ws.on("error", (error) => {
        console.error(`❌ WebSocket error session=${ws.sessionId}`, error);
        cleanupConnection(ws, "error");
    });
});

const HEARTBEAT_INTERVAL_MS = 15000;
const heartbeatInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
        if (!ws || ws._cleanedUp) return;
        if (ws.isAlive === false) {
            cleanupConnection(ws, "heartbeat-timeout");
            try {
                ws.terminate();
            } catch (error) {
                console.error(`❌ ws terminate failed session=${ws.sessionId}`, error);
            }
            return;
        }

        ws.isAlive = false;
        try {
            ws.ping();
        } catch (error) {
            console.error(`❌ ws ping failed session=${ws.sessionId}`, error);
            cleanupConnection(ws, "heartbeat-ping-failed");
            try {
                ws.terminate();
            } catch (terminateError) {
                console.error(`❌ ws terminate failed session=${ws.sessionId}`, terminateError);
            }
        }
    });
}, HEARTBEAT_INTERVAL_MS);

const ZOMBIE_SWEEP_INTERVAL_MS = 30000;
const zombieTableSweepInterval = setInterval(() => {
    Object.values(tables).forEach((table) => {
        const realPlayers = table.players.filter(p => !p.isAi).length;
        if (realPlayers === 0 && hasStaleTableState(table)) {
            console.log(`🧹 Zombie sweep reset for ${table.tableId}`);
            hardResetTable(table);
            broadcastToTable(table.tableId, {
                type: "table:reset",
                tableId: table.tableId
            });
        }
    });
}, ZOMBIE_SWEEP_INTERVAL_MS);

// =========================
// WS HELPER FUNCTIONS
// =========================
function validateUser(ws, d) {
    const u = validUsers.find(x => x.username === d.username && x.token === d.token);

    if (!u) return wsSend(ws, { type: "user:validate:res", success: false, error: "Invalid user or token" });

    wsSend(ws, { type: "user:validate:res", success: true, result: u });
}

function checkBalance(ws, d) {
    const u = validUsers.find(x => x.username === d.username);

    if (!u) return wsSend(ws, { type: "user:balance:res", balance: 0, error: "User not found" });

    wsSend(ws, { type: "user:balance:res", balance: u.balance, error: "" });
}

function sendAiPlayers(ws) {
    wsSend(ws, { type: "ai:players:list:res", result: aiPlayersList });
}

function sendTableList(ws) {
    const list = Object.values(tables).map(t => ({
        tableId: t.tableId,
        tableName: t.tableName,
        minBuyIn: t.minBuyIn,
        maxBuyIn: t.maxBuyIn,
        defaultBet: t.defaultBet,
        currentPlayers: t.players.length,
        maxPlayers: t.maxPlayers
    }));

    wsSend(ws, { type: "tables:list:res", result: list });
}

function playerBet(ws, data) {
    const table = tables[data.tableId];
    if (!table || !table.betInterval) return;

    const player = table.players.find(p => p.username === data.username);
    if (!player) return;

    player.currentBet = Math.min(data.betAmount, player.balance);
    console.log(`${player.username} placed bet: ${player.currentBet}`);

    broadcastToTable(table.tableId, {
        type: "table:update",
        players: table.players.map(p => ({
            username: p.username,
            seatId: p.seatId,
            currentBet: p.currentBet,
            balance: p.balance
        }))
    });
}

// ===== RUN SERVER =====
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 WebSocket server running on port ${PORT}`));

process.on("uncaughtException", (error) => {
    console.error("❌ uncaughtException", error);
});

process.on("unhandledRejection", (reason) => {
    console.error("❌ unhandledRejection", reason);
});

function stopBackgroundIntervals() {
    clearInterval(heartbeatInterval);
    clearInterval(zombieTableSweepInterval);
}

process.on("SIGINT", stopBackgroundIntervals);
process.on("SIGTERM", stopBackgroundIntervals);
process.on("exit", stopBackgroundIntervals);

module.exports = {
    validateUser,
    checkBalance,
    sendAiPlayers,
    sendTableList,
    playerBet
};
