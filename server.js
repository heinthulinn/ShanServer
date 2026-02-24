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

// =========================
// WEBSOCKET CONNECTION
// =========================
wss.on("connection", (ws) => {
    console.log("🔌 WebSocket client connected!");

    ws.send(JSON.stringify({ type: "connected", message: "Welcome!" }));

    const { handleWsMessage } = require("./ws/router");

    ws.on("message", (msg) => {
        handleWsMessage(ws, msg);
    });

    ws.on("close", () => {
        if (!ws.tableId || !ws.username) return;
        console.log(`❌ ${ws.username} disconnected from ${ws.tableId}`);
        const table = tables[ws.tableId];
        if (table) {
            const player = table.players.find(p => p.username === ws.username && !p.isAi);
            if (player) player.ws = null;
        }
        try {
            leaveTable(ws, { tableId: ws.tableId, username: ws.username, isDisconnect: true });
        } catch (error) {
            console.error(`❌ leaveTable crashed on close user=${ws.username} table=${ws.tableId}`, error);
        }
    });
});

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

module.exports = {
    validateUser,
    checkBalance,
    sendAiPlayers,
    sendTableList,
    playerBet
};
