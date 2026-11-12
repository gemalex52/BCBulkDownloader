// Bandcamp Content Script: Discography & Free Release Scanner

(function() {
  function scanFullDiscography() {
    const isBandcamp = window.location.hostname.endsWith('bandcamp.com');
    if (!isBandcamp) return { error: 'Not on a Bandcamp domain.' };

    if (typeof discoverCatalogItemsFromHtml === 'function') {
      try {
        const result = discoverCatalogItemsFromHtml(document.documentElement.outerHTML, window.location.href);
        return {
          success: true,
          ...result,
          url: window.location.href
        };
      } catch (e) {}
    }

    const artistName = document.querySelector('#band-name-location .title')?.textContent?.trim() ||
                       document.querySelector('meta[property="og:site_name"]')?.content ||
                       window.location.hostname.split('.')[0];

    const bioImg = document.querySelector('#bio-container .bio-pic img') ||
                   document.querySelector('.band-photo') ||
                   document.querySelector('img.photo');
    const artistBioPicUrl = bioImg ? (bioImg.getAttribute('src') || '').replace(/_\d+\.jpg/, '_10.jpg') : '';

    const itemsMap = new Map();

    const isDirectRelease = window.location.pathname.startsWith('/album/') || window.location.pathname.startsWith('/track/');
    if (isDirectRelease) {
      const pageTitle = document.querySelector('#name-section .trackTitle, .trackTitle, h2.trackTitle')?.textContent?.trim() || document.title;
      const coverImg = document.querySelector('#tralbumArt img, .tralbumArt img');
      const coverUrl = coverImg ? (coverImg.getAttribute('src') || '').replace(/_\d+\.jpg/, '_10.jpg') : '';
      const isAlbum = window.location.pathname.startsWith('/album/');
      const normKey = window.location.pathname.replace(/\/+$/, '').toLowerCase();
      itemsMap.set(normKey, {
        id: (isAlbum ? 'album-' : 'track-') + normKey.replace('/album/', '').replace('/track/', ''),
        itemId: 0,
        href: window.location.href,
        pageUrl: window.location.pathname,
        title: pageTitle,
        artUrl: coverUrl,
        artist: artistName,
        artistBioPicUrl,
        type: isAlbum ? 'album' : 'track'
      });
      return {
        success: true,
        artist: artistName,
        artistBioPicUrl,
        url: window.location.href,
        items: Array.from(itemsMap.values())
      };
    }

    // 1. Initial rendered <li> items from music-grid (matches any li inside music-grid or music-grid-item)
    const gridItems = document.querySelectorAll('#music-grid li, ol.music-grid li, li.music-grid-item, #featured-item');
    gridItems.forEach((li) => {
      const link = li.querySelector('a[href*="/album/"], a[href*="/track/"]');
      if (!link) return;

      const rawHref = link.getAttribute('href');
      if (!rawHref) return;

      let pathname;
      let fullHref;
      try {
        const u = new URL(rawHref, window.location.origin);
        pathname = u.pathname;
        fullHref = u.href;
      } catch {
        return;
      }

      const isAlbum = pathname.startsWith('/album/');
      const isTrack = pathname.startsWith('/track/');
      if (!isAlbum && !isTrack) return;

      const normKey = pathname.replace(/\/+$/, '').toLowerCase();
      if (itemsMap.has(normKey)) return;

      const titleEl = li.querySelector('p.title') || li.querySelector('.title');
      let title = 'Untitled';
      let itemArtist = artistName;
      if (titleEl) {
        const artistSpan = titleEl.querySelector('.artist-override, .artist') || li.querySelector('.artist-override, .artist');
        if (artistSpan && artistSpan.textContent.trim()) {
          itemArtist = artistSpan.textContent.trim();
        }
        const clone = titleEl.cloneNode(true);
        clone.querySelectorAll('.artist-override, .artist').forEach((el) => el.remove());
        title = clone.textContent.trim().replace(/\s+/g, ' ');
      }

      const img = li.querySelector('img');
      const rawSrc = img ? (img.getAttribute('data-original') || img.getAttribute('src') || '') : '';
      const artUrl = rawSrc && !rawSrc.includes('blank.gif') ? rawSrc.replace(/_\d+\.jpg/, '_10.jpg') : '';
      const rawId = li.getAttribute('data-item-id') || link.getAttribute('data-item-id') || (isAlbum ? 'album-' : 'track-') + normKey.replace('/album/', '').replace('/track/', '');

      itemsMap.set(normKey, {
        id: rawId,
        itemId: parseInt(rawId.replace(/\D/g, '') || '0', 10),
        href: fullHref,
        pageUrl: pathname,
        title,
        artUrl,
        artist: itemArtist,
        artistBioPicUrl,
        type: isAlbum ? 'album' : 'track'
      });
    });

    // 2. Remaining items from data-client-items on ol#music-grid
    const musicGrid = document.querySelector('ol#music-grid');
    if (musicGrid) {
      const clientData = musicGrid.getAttribute('data-client-items');
      if (clientData) {
        try {
          const clientItems = JSON.parse(clientData);
          clientItems.forEach((item) => {
            const pageUrl = item.page_url;
            if (!pageUrl) return;
            const pathname = pageUrl.split('?')[0];
            const normKey = pathname.replace(/\/+$/, '').toLowerCase();
            if (!itemsMap.has(normKey)) {
              const isAlbum = item.type === 'album' || normKey.startsWith('/album/');
              itemsMap.set(normKey, {
                id: (item.type || 'item') + '-' + item.id,
                itemId: item.id || 0,
                href: window.location.origin + pathname,
                pageUrl: pathname,
                title: item.title,
                artUrl: item.art_id ? ('https://f4.bcbits.com/img/a' + item.art_id + '_10.jpg') : '',
                artist: item.band_name || item.artist_name || item.artist || artistName,
                artistBioPicUrl,
                type: isAlbum ? 'album' : 'track'
              });
            }
          });
        } catch(e) {}
      }
    }

    return {
      success: true,
      artist: artistName,
      artistBioPicUrl,
      url: window.location.href,
      items: Array.from(itemsMap.values())
    };
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'SCAN_DISCOGRAPHY') {
      sendResponse(scanFullDiscography());
    }
  });

  // Resilient floating button on Bandcamp pages to open Dedicated Scanner Tab directly
  function injectPageButton() {
    if (window.top !== window.self) return;
    if (document.getElementById('bc-bulk-open-tab-host')) return;

    const rootTarget = document.documentElement;
    if (!rootTarget) {
      setTimeout(injectPageButton, 100);
      return;
    }

    const host = document.createElement('div');
    host.id = 'bc-bulk-open-tab-host';
    host.style.cssText = 'all: initial !important; position: fixed !important; bottom: 24px !important; right: 24px !important; z-index: 2147483647 !important; pointer-events: auto !important; display: block !important;';

    const shadow = host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = `
      :host {
        all: initial !important;
        position: fixed !important;
        bottom: 24px !important;
        right: 24px !important;
        z-index: 2147483647 !important;
        display: block !important;
      }
      .bc-dl-btn {
        all: unset !important;
        display: inline-flex !important;
        align-items: center !important;
        gap: 8px !important;
        background: linear-gradient(135deg, #00b4d8 0%, #0096c7 100%) !important;
        color: #0b0f17 !important;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
        font-size: 13px !important;
        font-weight: 800 !important;
        letter-spacing: 0.3px !important;
        line-height: 1 !important;
        padding: 9px 15px !important;
        border-radius: 9999px !important;
        border: 2px solid #ffffff !important;
        box-shadow: 0 4px 18px rgba(0, 0, 0, 0.6), 0 0 10px rgba(0, 180, 216, 0.4) !important;
        cursor: pointer !important;
        user-select: none !important;
        transition: transform 0.15s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 0.15s ease !important;
      }
      .bc-dl-btn:hover {
        transform: scale(1.07) translateY(-1px) !important;
        box-shadow: 0 6px 22px rgba(0, 0, 0, 0.7), 0 0 16px rgba(0, 180, 216, 0.6) !important;
      }
      .bc-dl-btn:active {
        transform: scale(0.97) !important;
      }
      .bc-icon-svg {
        width: 18px !important;
        height: 18px !important;
        flex-shrink: 0 !important;
      }
    `;

    const btn = document.createElement('button');
    btn.className = 'bc-dl-btn';
    btn.setAttribute('type', 'button');
    btn.setAttribute('title', 'Open Bandcamp Bulk Downloader Dashboard for this artist');
    btn.innerHTML = `
      <svg class="bc-icon-svg" viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="128" height="128" rx="26" fill="#0b0f17"/>
        <path d="M26 86 L50 26 H86 L62 86 Z" fill="#00b4d8"/>
        <path d="M68 38 V64 H56 L76 90 L96 64 H84 V38 Z" fill="#ffffff"/>
        <rect x="56" y="96" width="40" height="6" rx="3" fill="#38bdf8"/>
      </svg>
      <span>Downloader</span>
    `;

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        chrome.runtime.sendMessage({
          action: 'OPEN_DASHBOARD_TAB',
          url: window.location.href,
          autostart: false
        });
      } catch (err) {
        console.warn('[BandcampDL] Failed to open dashboard tab:', err);
      }
    });

    shadow.appendChild(style);
    shadow.appendChild(btn);
    rootTarget.appendChild(host);
    console.log('[BandcampDL] Floating button mounted successfully on', window.location.hostname);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectPageButton);
  } else {
    injectPageButton();
  }
  window.addEventListener('load', injectPageButton);
  setTimeout(injectPageButton, 300);
  setTimeout(injectPageButton, 1200);
  setTimeout(injectPageButton, 3000);

  // Re-inject if page dynamically updates or navigates via SPA
  try {
    const observer = new MutationObserver(() => {
      if (!document.getElementById('bc-bulk-open-tab-host')) {
        injectPageButton();
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: false });
  } catch(e) {}
})();
