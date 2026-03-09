const { validUsers } = require("../state/users");
const { tables } = require("../state/tables");

function findPersistedUser(username) {
  return validUsers.find((user) => user.username === username) || null;
}

function findSeatedRealPlayer(username) {
  for (const table of Object.values(tables)) {
    const player = table.players.find(
      (candidate) => !candidate.isAi && candidate.username === username
    );
    if (player) {
      return { table, player };
    }
  }

  return null;
}

function getAuthoritativeUserBalance(username) {
  const seatedPlayer = findSeatedRealPlayer(username);
  if (seatedPlayer) {
    return Number(seatedPlayer.player.balance) || 0;
  }

  const persistedUser = findPersistedUser(username);
  if (!persistedUser) return null;
  return Number(persistedUser.balance) || 0;
}

function syncRealPlayerBalance(username, balance) {
  const persistedUser = findPersistedUser(username);
  if (!persistedUser) return false;

  persistedUser.balance = Number(balance) || 0;
  return true;
}

function syncRealPlayerEntityBalance(player) {
  if (!player || player.isAi) return false;
  return syncRealPlayerBalance(player.username, player.balance);
}

function syncTableRealPlayerBalances(table) {
  if (!table || !Array.isArray(table.players)) return 0;

  let syncedCount = 0;
  table.players.forEach((player) => {
    if (syncRealPlayerEntityBalance(player)) {
      syncedCount += 1;
    }
  });

  return syncedCount;
}

module.exports = {
  getAuthoritativeUserBalance,
  syncRealPlayerBalance,
  syncRealPlayerEntityBalance,
  syncTableRealPlayerBalances
};
