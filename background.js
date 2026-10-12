/**
 * Mureka Audio Splitter - Background Service Worker (Manifest V3)
 * Handles cookie extraction, audio stream routing, persistent window management, and side panels.
 */

// Format cookies into Netscape HTTP Cookie File format
function formatNetscapeCookies(cookies) {
  const lines = [
    '# Netscape HTTP Cookie File',
    '# Created by Mureka Audio Splitter Chrome Extension',
    '# https://www.youtube.com'
  ];
  for (const c of cookies) {
    const domain = c.domain.startsWith('.') ? c.domain : '.' + c.domain;
    const flag = domain.startsWith('.') ? 'TRUE' : 'FALSE';
    const path = c.path || '/';
    const secure = c.secure ? 'TRUE' : 'FALSE';
    const exp = c.expirationDate ? Math.floor(c.expirationDate) : Math.floor(Date.now() / 1000) + 86400 * 365;
    lines.push(`${domain}\t${flag}\t${path}\t${secure}\t${exp}\t${c.name}\t${c.value}`);
  }
  return lines.join('\n');
}

// Convert cookie list to HTTP Cookie header string
function formatCookieHeader(cookies) {
  return cookies.map(c => `${c.name}=${c.value}`).join('; ');
}

// Extract cookies for YouTube domain
async function getYouTubeCookies() {
  try {
    const domainCookies = await chrome.cookies.getAll({ domain: '.youtube.com' });
    const rootCookies = await chrome.cookies.getAll({ url: 'https://www.youtube.com' });
    
    // Merge unique cookies by name
    const cookieMap = new Map();
    for (const c of [...domainCookies, ...rootCookies]) {
      cookieMap.set(c.name, c);
    }
    const cookies = Array.from(cookieMap.values());
    
    const netscape = formatNetscapeCookies(cookies);
    const header = formatCookieHeader(cookies);

    // Save to local storage for persistence
    await chrome.storage.local.set({
      yt_cookies_list: cookies,
      yt_cookies_header: header,
      yt_cookies_netscape: netscape,
      yt_cookies_timestamp: Date.now(),
      yt_cookies_count: cookies.length
    });

    return {
      success: true,
      count: cookies.length,
      netscape: netscape,
      header: header,
      cookies: cookies
    };
  } catch (err) {
    console.error('Failed to get YouTube cookies:', err);
    return { success: false, error: err.message };
  }
}

// Open Dedicated Floating Window (Persistent OS Window - Never auto-closes on blur!)
async function openDedicatedWindow() {
  const url = chrome.runtime.getURL('popup.html?mode=full');
  const current = await chrome.windows.getCurrent().catch(() => null);
  const left = current ? Math.max(50, current.left + 50) : 100;
  const top = current ? Math.max(50, current.top + 50) : 100;

  return chrome.windows.create({
    url: url,
    type: 'popup',
    width: 980,
    height: 820,
    left: left,
    top: top,
    focused: true
  });
}

// Message Listener
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'GET_YT_COOKIES') {
    getYouTubeCookies().then(sendResponse);
    return true;
  }

  if (request.action === 'OPEN_STUDIO') {
    chrome.tabs.create({ url: chrome.runtime.getURL('popup.html?mode=full') });
    sendResponse({ success: true });
    return true;
  }

  if (request.action === 'OPEN_WINDOW') {
    openDedicatedWindow().then(win => sendResponse({ success: true, windowId: win.id }));
    return true;
  }

  if (request.action === 'OPEN_SIDEPANEL') {
    if (chrome.sidePanel && chrome.sidePanel.open) {
      const windowId = sender.tab ? sender.tab.windowId : undefined;
      if (windowId) {
        chrome.sidePanel.open({ windowId }).then(() => sendResponse({ success: true })).catch(err => sendResponse({ success: false, error: err.message }));
      } else {
        chrome.windows.getCurrent().then(win => {
          chrome.sidePanel.open({ windowId: win.id })
            .then(() => sendResponse({ success: true }))
            .catch(err => sendResponse({ success: false, error: err.message }));
        });
      }
    } else {
      sendResponse({ success: false, error: 'Side panel API not supported on this Chrome build' });
    }
    return true;
  }

  if (request.action === 'CHECK_LOCAL_BRIDGE') {
    fetch('http://127.0.0.1:59955/status', { method: 'GET' })
      .then(res => res.json())
      .then(data => sendResponse({ online: true, data }))
      .catch(() => sendResponse({ online: false }));
    return true;
  }

  if (request.action === 'DOWNLOAD_SEGMENT') {
    const { url, filename } = request;
    chrome.downloads.download({
      url: url,
      filename: filename,
      conflictAction: 'uniquify',
      saveAs: false
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        sendResponse({ success: false, error: chrome.runtime.lastError.message });
      } else {
        sendResponse({ success: true, downloadId });
      }
    });
    return true;
  }
});

// Setup on extension install / update
chrome.runtime.onInstalled.addListener(() => {
  console.log('Mureka Audio Splitter Extension installed successfully.');
  getYouTubeCookies().catch(() => {});
});
