console.log("[Leetify Rank Tracker] Content script started execution");

// Selectors based on your HTML structure
const PLAYER_SELECTOR = 'td.player-meta-wrapper a.player-meta';
const RATING_SELECTOR = PLAYER_SELECTOR + ' app-rank-icon app-cs-rating';

function getMatchId() {
  const path = window.location.pathname;
  const match = path.match(/\/app\/match-details\/([^\/]+)/);
  return match ? match[1] : null;
}

function createOldRatingElement(originalRatingEl, oldRank) {
  try {
    const oldRatingEl = originalRatingEl.cloneNode(true);
    const tierClass = Array.from(oldRatingEl.classList).find(c => c.startsWith('--tier-'));
    if (tierClass) {
      oldRatingEl.classList.remove(tierClass);
      oldRatingEl.classList.add(getTierClassForRank(oldRank));
    }
    const labelLarge = oldRatingEl.querySelector('.label-large');
    const labelSmall = oldRatingEl.querySelector('.label-small');
    if (labelLarge) labelLarge.textContent = Math.floor(oldRank / 1000);
    if (labelSmall) labelSmall.textContent = oldRank % 1000;
    oldRatingEl.classList.add('old-rating');
    oldRatingEl.title = `Previous rank: ${oldRank}`;
    return oldRatingEl;
  } catch (e) {
    console.error("[createOldRatingElement] Error creating element:", e);
    return null;
  }
}

function getTierClassForRank(rank) {
  if (rank >= 30000) return '--tier-5';
  if (rank >= 20000) return '--tier-4';
  if (rank >= 10000) return '--tier-3';
  if (rank >= 5000) return '--tier-2';
  return '--tier-1';
}

function updatePlayerRankDisplays(rankData) {
  const players = document.querySelectorAll(PLAYER_SELECTOR);
  players.forEach((profileLink) => {
    try {
      const href = profileLink.getAttribute('href');
      if (!href) return;
      const steamId = href.split('/profile/')[1];
      if (!steamId) return;
      const playerData = rankData[steamId];
      if (!playerData) return;
      const ratingElement = profileLink.querySelector(RATING_SELECTOR);
      if (!ratingElement || ratingElement.previousElementSibling?.classList?.contains('old-rating')) return;
      const oldRatingEl = createOldRatingElement(ratingElement, playerData.oldRank);
      if (!oldRatingEl) return;
      ratingElement.parentNode.insertBefore(oldRatingEl, ratingElement);
      const rankDifferenceContainer = document.createElement('div');
      rankDifferenceContainer.className = 'rank-difference-container';
      const rankDifferenceText = document.createElement('div');
      rankDifferenceText.className = 'rank-difference-text';
      rankDifferenceText.textContent = `${playerData.difference >= 0 ? '+' : ''}${playerData.difference}`;
      rankDifferenceText.classList.add(playerData.difference >= 0 ? 'positive' : 'negative');
      rankDifferenceContainer.appendChild(rankDifferenceText);
      const arrow = document.createElement('div');
      arrow.className = 'rank-arrow';
      arrow.textContent = '→';
      rankDifferenceContainer.appendChild(arrow);
      ratingElement.parentNode.insertBefore(rankDifferenceContainer, ratingElement);
    } catch (e) {
      console.error("[updatePlayerRankDisplays] Error processing player:", e);
    }
  });
}

// Main execution flow
const matchId = getMatchId();
if (matchId) {
  const observer = new MutationObserver((mutations, obs) => {
    if (document.querySelector(RATING_SELECTOR)) {
      obs.disconnect();
      browser.runtime.sendMessage({
        action: "getRankData",
        matchId: matchId
      }).then(response => {
        if (response.success) {
          updatePlayerRankDisplays(response.data);
        }
      }).catch(e => {
        console.error("[Main] Error sending message:", e);
      });
    }
  });

  if (document.querySelector(RATING_SELECTOR)) {
    browser.runtime.sendMessage({
      action: "getRankData",
      matchId: matchId
    }).then(response => {
      if (response.success) {
        updatePlayerRankDisplays(response.data);
      }
    }).catch(e => {
      console.error("[Main] Immediate request error:", e);
    });
  } else {
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }
}

// Add some basic styling
const style = document.createElement('style');
style.textContent = `
  .old-rating {
    opacity: 0.8;
    filter: grayscale(30%);
    margin-right: 4px;
  }
  .rank-arrow {
    margin: 0 4px;
    font-size: 16px;
    line-height: 1;
  }
  .rank-arrow.up {
    color: #4CAF50;
  }
  .rank-arrow.down {
    color: #F44336;
  }
`;
document.head.appendChild(style);

console.log("[Leetify Rank Tracker] Content script initialization complete");