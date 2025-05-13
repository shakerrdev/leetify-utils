browser.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "getRankData") {
    const matchId = request.matchId;
    const apiUrl = `https://api.cs-prod.leetify.com/api/games/${matchId}`;
    fetch(apiUrl)
      .then(response => response.json())
      .then(data => {
        const rankData = {};
        if (data.matchmakingGameStats) {
          Object.entries(data.matchmakingGameStats).forEach(([key, player]) => {
            rankData[player.steam64Id] = {
              rank: player.rank,
              oldRank: player.oldRank,
              difference: player.rank - player.oldRank
            };
          });
        }
        sendResponse({ success: true, data: rankData });
      })
      .catch(error => {
        console.error("[Background] Error fetching rank data:", error);
        sendResponse({ success: false, error: error.message });
      });
    return true; // Required for async response
  }
});

console.log("[Leetify Rank Tracker] Background script loaded");