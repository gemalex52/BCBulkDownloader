// Bandcamp Bulk Downloader - Popup Script
document.addEventListener('DOMContentLoaded', () => {
  const siteTitle = document.getElementById('siteTitle');
  const sessionBadge = document.getElementById('sessionBadge');
  const statusDesc = document.getElementById('statusDesc');
  const btnOpenDashboard = document.getElementById('btnOpenDashboard');
  const btnQuickResume = document.getElementById('btnQuickResume');

  let activeUrl = 'https://esoctrilihum.bandcamp.com/music';
  let activeHostname = 'esoctrilihum.bandcamp.com';

  function normalizeUrl(raw) {
    if (!raw) return 'https://esoctrilihum.bandcamp.com/music';
    var c = raw.trim();
    if (c.indexOf('url=') !== -1) {
      var m = c.match(/url=([^&]+)/);
      if (m) {
        try { c = decodeURIComponent(m[1]); } catch(e) { c = m[1]; }
      }
    }
    try {
      if (c.indexOf('%3A') !== -1 || c.indexOf('%2F') !== -1) c = decodeURIComponent(c);
    } catch(e) {}
    c = c.replace(new RegExp('(/music)+$', 'i'), '/music');
    while (c.endsWith('/')) c = c.slice(0, -1);
    if (c.indexOf('http://') !== 0 && c.indexOf('https://') !== 0) c = 'https://' + c;
    try {
      var u = new URL(c);
      if (u.hostname.endsWith('.bandcamp.com') && (u.pathname === '' || u.pathname === '/')) {
        c = u.origin + '/music';
      }
    } catch(e) {}
    return c;
  }

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs && tabs[0];
    if (
      tab &&
      tab.url &&
      !tab.url.startsWith('chrome-extension://') &&
      !tab.url.startsWith('moz-extension://') &&
      !tab.url.includes('dashboard.html') &&
      (tab.url.includes('.bandcamp.com') || tab.url.includes('bandcamp.com/'))
    ) {
      activeUrl = normalizeUrl(tab.url);
      try {
        activeHostname = new URL(activeUrl).hostname;
      } catch(e) {}
    }

    siteTitle.textContent = activeHostname;

    const sessionKey = 'bc_session_v2_' + activeHostname.toLowerCase();
    chrome.storage.local.get([sessionKey], (res) => {
      const sess = res && res[sessionKey];
      if (sess && sess.items) {
        const itemIds = Object.keys(sess.items);
        const completed = itemIds.filter(id => sess.items[id].stage === 'completed').length;
        const failed = itemIds.filter(id => sess.items[id].stage === 'failed').length;
        const pending = itemIds.filter(id => sess.items[id].stage === 'pending').length;

        if (completed > 0 && (pending > 0 || failed > 0)) {
          sessionBadge.textContent = 'Can Resume';
          sessionBadge.className = 'session-badge resume';
          statusDesc.textContent = 'Session active: ' + completed + ' completed, ' + (pending + failed) + ' remaining (' + failed + ' failed). Click Resume to continue without re-downloading finished releases.';
          btnQuickResume.style.display = 'block';
          btnQuickResume.textContent = '▶ Resume Download (' + (pending + failed) + ' remaining)';
        } else {
          sessionBadge.textContent = completed + '/' + itemIds.length + ' done';
          sessionBadge.className = 'session-badge ready';
          statusDesc.textContent = 'Catalog cached: ' + itemIds.length + ' releases discovered. Ready to scan and download paired studio audio & companion info ZIPs.';
        }
      } else {
        sessionBadge.textContent = 'New Site';
        statusDesc.textContent = 'Ready to discover releases and download lossless FLAC with untruncated info.txt, artwork, photos, and lyrics.';
      }
    });
  });

  function openDedicatedTab(autostart) {
    let targetUrl = 'dashboard.html';
    const params = [];
    const clean = normalizeUrl(activeUrl);
    if (clean) params.push('url=' + encodeURIComponent(clean));
    if (autostart) params.push('autostart=1');
    if (params.length > 0) targetUrl += '?' + params.join('&');

    const fullUrl = chrome.runtime.getURL(targetUrl);
    if (chrome.tabs && chrome.tabs.create) {
      chrome.tabs.create({ url: fullUrl }, () => {
        window.close();
      });
    } else {
      chrome.runtime.sendMessage({
        action: 'OPEN_DASHBOARD_TAB',
        url: activeUrl,
        autostart: Boolean(autostart)
      }, () => {
        window.close();
      });
    }
  }

  btnOpenDashboard.addEventListener('click', (e) => {
    e.preventDefault();
    openDedicatedTab(false);
  });

  btnQuickResume.addEventListener('click', (e) => {
    e.preventDefault();
    openDedicatedTab(true);
  });
});
