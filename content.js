/**
 * Mureka Audio Splitter - Content Script (YouTube)
 * Automatically detects current video information and provides 1-click split integration.
 */

// Helper to extract clean video ID
function getVideoId() {
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get('v');
}

// Get video metadata from active YouTube DOM
function getVideoDetails() {
  const video = document.querySelector('video');
  const titleEl = document.querySelector('h1.ytd-watch-metadata, #title h1, h1.title');
  const title = titleEl ? titleEl.innerText.trim() : document.title.replace(' - YouTube', '').trim();
  const videoId = getVideoId();

  return {
    videoId: videoId,
    url: window.location.href,
    title: title,
    duration: video ? video.duration : 0,
    currentTime: video ? video.currentTime : 0
  };
}

// Listen for messages from extension popup or background
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'GET_CURRENT_VIDEO') {
    const details = getVideoDetails();
    sendResponse({ success: !!details.videoId, data: details });
    return true;
  }
});

// Inject "✂ Split in Mureka" button under YouTube video player
function injectMurekaButton() {
  if (!window.location.pathname.startsWith('/watch')) return;
  if (document.getElementById('mureka-split-btn')) return;

  const actionsBar = document.querySelector('#top-level-buttons-computed, #actions-inner #menu');
  if (!actionsBar) return;

  const btn = document.createElement('button');
  btn.id = 'mureka-split-btn';
  btn.className = 'mureka-yt-btn';
  btn.innerHTML = `
    <span class="mureka-yt-btn-icon">✂</span>
    <span class="mureka-yt-btn-text">Split in Mureka</span>
  `;

  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const details = getVideoDetails();
    // Save current video details into storage so popup immediately loads it
    chrome.storage.local.set({
      mureka_active_yt_video: details
    }, () => {
      chrome.runtime.sendMessage({ action: 'OPEN_STUDIO' });
    });
  });

  actionsBar.appendChild(btn);
}

// Observe DOM changes (YouTube is a single-page app)
const observer = new MutationObserver(() => {
  injectMurekaButton();
});

observer.observe(document.body, { childList: true, subtree: true });

// Initial check
setTimeout(injectMurekaButton, 1500);
