export const GAS_SCRIPT_TEMPLATE = `/**
 * Bandcamp Bulk Downloader - Gmail Watchdog Webhook (Google Apps Script)
 * Optimized quota-saving POST batch + GET single lookup webhook.
 *
 * INSTRUCTIONS:
 * 1. Open https://script.google.com and click "New Project" (or open existing project).
 * 2. Paste this entire script into Code.gs (replacing everything).
 * 3. Change SECRET_PASSWORD below to your own secret key (e.g. 'my_bandcamp_secret_2026').
 * 4. Click Deploy -> New deployment (or Manage deployments -> Edit -> New version).
 * 5. Select type "Web app", set "Execute as" = "Me (<your email>)" and "Who has access" = "Anyone".
 * 6. Click Deploy, Authorize access, and copy the Web App URL (https://script.google.com/macros/s/.../exec).
 * 7. Paste the Web App URL and Secret Password into the Bulk Downloader settings.
 */

const LOG_LEVELS = ['DEBUG', 'INFO', 'WARN', 'ERROR'];
const LOG_LEVEL = 'INFO';

const MAIL_SEARCH_LOOKBACK_SEC = 5; // default lookback window (seconds) when no since is specified
const MAIL_SEARCH_MAX_THREADS = 50; // max matching Gmail threads to inspect per lookup

const SECRET_PASSWORD = 'CHANGE_THIS_SECRET_PASSWORD';

function normalizeCleanId(rawId) {
  if (rawId === undefined || rawId === null) return '';
  return String(rawId).replace(/^(album|track)-/, '').trim();
}

function escapeRegExpLiteral(str) {
  return String(str).replace(/[.*+?^$&{}()|[\\]\\\\]/g, '\\\\$&');
}

function doItemsSearch(params, items) {
  appLog('INFO', 'Params', JSON.stringify(params));

  // Authorize
  if (!params.secret || params.secret !== SECRET_PASSWORD) {
    appLog('WARN', 'Wrong or missing secret');
    return enrichArray(items, {
      found: false,
      error: 'Unauthorized: Invalid or missing password parameter',
    });
  }

  // Ping / test mode (supports both 'true' string and boolean true)
  if (params.test === 'true' || params.test === true) {
    appLog('INFO', 'Test OK');
    return enrichArray(items, {
      found: false,
      test: true,
      batchSupported: true,
      serverTime: Math.floor(Date.now() / 1000),
      message: 'GAS Webhook (POST-enabled) is active and authorized successfully!',
    });
  }

  if (!Array.isArray(items) || items.length === 0) {
    return [];
  }

  // Build Gmail search command
  let query = 'from:bandcamp.com "bandcamp.com/download"';
  const sinceSec = Number(params.since) || Math.floor(Date.now() / 1000 - MAIL_SEARCH_LOOKBACK_SEC);
  query += ' after:' + sinceSec;

  // Prepare output array with pre-compiled per-item RegExp (strict numeric id= boundary prevents prefix collisions)
  const results = items.map((i) => {
    const cleanId = normalizeCleanId(i && i.id);
    const escapedId = cleanId ? escapeRegExpLiteral(cleanId) : '';
    const idClause = escapedId ? '(?:[^\\\\s"<>]*[?&])?id=' + escapedId + '(?=[&#\\\\s"<>]|$)[^\\\\s"<>]*' : '[^\\\\s"<>]+';
    const rePattern = 'https?:\\\\/\\\\/[a-z0-9.-]*bandcamp\\\\.com\\\\/download\\\\?' + idClause;

    appLog('DEBUG', 'Item "' + (i?.title || '') + '" RE', rePattern);

    const obj = {
      title: i && i.title !== undefined && i.title !== null ? String(i.title) : '',
      id: i && i.id !== undefined && i.id !== null ? i.id : '',
      found: false,
      _cleanId: cleanId,
      _regexp: new RegExp(rePattern, 'i'),
      _since: Number(i && i.since) || sinceSec,
    };
    if (i && i.since !== undefined && i.since !== null && i.since !== '') {
      obj.since = i.since;
    }
    return obj;
  });

  appLog('INFO', 'Search Query', query);

  const threads = GmailApp.search(query, 0, MAIL_SEARCH_MAX_THREADS);
  if (threads.length > 0) {
    const recentMessages = GmailApp.getMessagesForThreads(threads)
      .flat()
      // QUOTA SAVER: Filter out older messages in the thread BEFORE calling getPlainBody()
      .map((msg) => ({
        rawMsg: msg,
        date: Math.floor(msg.getDate().getTime() / 1000),
      }))
      .filter((msg) => msg.date >= sinceSec)
      .sort((a, b) => b.date - a.date);

    let msgIdx = recentMessages.length;
    appLog('INFO', 'Threads found: ' + threads.length + ', recent messages: ' + msgIdx);

    for (const msg of recentMessages) {
      const pendingItems = results.filter((i) => !i.found);
      if (pendingItems.length < 1) break;

      const pendingByTime = pendingItems.filter((i) => i._since <= msg.date);
      if (pendingByTime.length > 0) {
        const body = msg.rawMsg.getPlainBody();
        appLog('DEBUG', 'Matching ' + pendingByTime.length + ' items against message #' + msgIdx + ' (date: ' + msg.date + ')');

        for (const item of pendingByTime) {
          const match = body.match(item._regexp);
          if (match) {
            const dlUrl = match[0].replace(/&amp;/g, '&').trim();
            appLog('INFO', 'Link found for ' + item.title, dlUrl);

            try {
              msg.rawMsg.markRead();
            } catch (e) {}

            item.found = true;
            item.downloadPageUrl = dlUrl;
            item.messageId = msg.rawMsg.getId();
            item.receivedAt = msg.date;
            break;
          }
        }
      } else {
        appLog('DEBUG', 'Skipping Message ' + msgIdx + ': too old for remaining items');
      }

      msgIdx--;
    }
  }

  return results.map((r) => {
    const clean = {
      id: r.id,
      title: r.title,
      found: r.found,
    };
    if (r.since !== undefined) clean.since = r.since;
    if (r.downloadPageUrl) clean.downloadPageUrl = r.downloadPageUrl;
    if (r.messageId) clean.messageId = r.messageId;
    if (r.receivedAt) clean.receivedAt = r.receivedAt;
    return clean;
  });
}

function enrichArray(items, resultTemplate = {}) {
  if (!Array.isArray(items) || items.length === 0) {
    return [{ id: '', title: '', ...resultTemplate }];
  }
  return items.map((i) => ({
    id: i?.id || '',
    title: i?.title || '',
    ...resultTemplate,
  }));
}

function doGet(data) {
  try {
    appLog('INFO', 'GET Webhook Invoked');
    const params = data?.parameter || {};
    const item = {
      id: params.id || '',
      title: decodeURIComponent((params.title || '').replace(/\\+/g, ' ')),
      since: params.since,
    };
    const results = doItemsSearch(params, [item]);
    return createJsonResponse(results[0] || { found: false });
  } catch (err) {
    const errorStr = err.toString();
    appLog('ERROR', 'GET processing error', errorStr);
    return createJsonResponse({
      found: false,
      error: errorStr,
    });
  }
}

function doPost(data) {
  try {
    appLog('INFO', 'POST Webhook Invoked');
    const rawBody = data?.postData?.contents || '[]';
    appLog('DEBUG', 'Body', rawBody);

    const parsedBody = JSON.parse(rawBody);
    const items = Array.isArray(parsedBody)
      ? parsedBody
      : (Array.isArray(parsedBody?.items) ? parsedBody.items : [parsedBody]);

    const params = data?.parameter || {};
    params.secret =
      params.secret ||
      (!Array.isArray(parsedBody) ? parsedBody?.secret : '') ||
      (items.length > 0 ? items[0]?.secret : '');

    // Find earliest since value across root params, body.since, and per-item since
    const minItemSince = items.reduce(
      (minSince, curItem) => {
        const s = Number(curItem?.since) || 0;
        if (s <= 0) return minSince;
        return minSince <= 0 ? s : Math.min(minSince, s);
      },
      0
    );
    const rootSince = Number((!Array.isArray(parsedBody) ? parsedBody?.since : 0) || params.since) || 0;
    params.since = (minItemSince > 0 && rootSince > 0)
      ? Math.min(minItemSince, rootSince)
      : (minItemSince || rootSince || 0);

    params.test = params.test || (!Array.isArray(parsedBody) ? parsedBody?.test : '');

    const results = doItemsSearch(params, items);
    return createJsonResponse(results);
  } catch (err) {
    const errorStr = err.toString();
    appLog('ERROR', 'POST processing error', errorStr);
    return createJsonResponse({
      found: false,
      error: errorStr,
    });
  }
}

function createJsonResponse(data) {
  const respString = JSON.stringify(data);
  appLog('DEBUG', 'Response', respString);
  return ContentService.createTextOutput(respString).setMimeType(ContentService.MimeType.JSON);
}

// Structured Logging
function appLog(logLevel, message, value = '') {
  try {
    const baseLevel = LOG_LEVELS.indexOf(LOG_LEVEL);
    const level = LOG_LEVELS.indexOf(logLevel);
    if (level >= baseLevel) {
      const valStr = value !== undefined && value !== null ? String(value) : '';
      const entry = message + (valStr.length > 0 ? ': ' + valStr : '');
      switch (logLevel) {
        case 'ERROR':
          console.error(entry);
          break;
        case 'WARN':
          console.warn(entry);
          break;
        case 'INFO':
          console.info(entry);
          break;
        default:
          console.log(entry);
      }
    }
  } catch (e) {
    console.error('Failed to write to log: ' + e.toString());
  }
}
`;
