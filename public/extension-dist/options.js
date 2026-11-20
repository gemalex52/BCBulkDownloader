(function() {
  'use strict';
  // Bandcamp Bulk Downloader - Options Script
  const GAS_CODE_GS = "/**\n * Bandcamp Bulk Downloader - Gmail Watchdog Webhook (Google Apps Script)\n * Optimized quota-saving POST batch + GET single lookup webhook.\n *\n * INSTRUCTIONS:\n * 1. Open https://script.google.com and click \"New Project\" (or open existing project).\n * 2. Paste this entire script into Code.gs (replacing everything).\n * 3. Change SECRET_PASSWORD below to your own secret key (e.g. 'my_bandcamp_secret_2026').\n * 4. Click Deploy -> New deployment (or Manage deployments -> Edit -> New version).\n * 5. Select type \"Web app\", set \"Execute as\" = \"Me (<your email>)\" and \"Who has access\" = \"Anyone\".\n * 6. Click Deploy, Authorize access, and copy the Web App URL (https://script.google.com/macros/s/.../exec).\n * 7. Paste the Web App URL and Secret Password into the Bulk Downloader settings.\n */\n\nconst LOG_LEVELS = ['DEBUG', 'INFO', 'WARN', 'ERROR'];\nconst LOG_LEVEL = 'INFO';\n\nconst MAIL_SEARCH_LOOKBACK_SEC = 5; // default lookback window (seconds) when no since is specified\nconst MAIL_SEARCH_MAX_THREADS = 50; // max matching Gmail threads to inspect per lookup\n\nconst SECRET_PASSWORD = 'CHANGE_THIS_SECRET_PASSWORD';\n\nfunction normalizeCleanId(rawId) {\n  if (rawId === undefined || rawId === null) return '';\n  return String(rawId).replace(/^(album|track)-/, '').trim();\n}\n\nfunction escapeRegExpLiteral(str) {\n  return String(str).replace(/[.*+?^$&{}()|[\\]\\\\]/g, '\\\\$&');\n}\n\nfunction doItemsSearch(params, items) {\n  appLog('INFO', 'Params', JSON.stringify(params));\n\n  // Authorize\n  if (!params.secret || params.secret !== SECRET_PASSWORD) {\n    appLog('WARN', 'Wrong or missing secret');\n    return enrichArray(items, {\n      found: false,\n      error: 'Unauthorized: Invalid or missing password parameter',\n    });\n  }\n\n  // Ping / test mode (supports both 'true' string and boolean true)\n  if (params.test === 'true' || params.test === true) {\n    appLog('INFO', 'Test OK');\n    return enrichArray(items, {\n      found: false,\n      test: true,\n      batchSupported: true,\n      serverTime: Math.floor(Date.now() / 1000),\n      message: 'GAS Webhook (POST-enabled) is active and authorized successfully!',\n    });\n  }\n\n  if (!Array.isArray(items) || items.length === 0) {\n    return [];\n  }\n\n  // Build Gmail search command\n  let query = 'from:bandcamp.com \"bandcamp.com/download\"';\n  const sinceSec = Number(params.since) || Math.floor(Date.now() / 1000 - MAIL_SEARCH_LOOKBACK_SEC);\n  query += ' after:' + sinceSec;\n\n  // Prepare output array with pre-compiled per-item RegExp (strict numeric id= boundary prevents prefix collisions)\n  const results = items.map((i) => {\n    const cleanId = normalizeCleanId(i && i.id);\n    const escapedId = cleanId ? escapeRegExpLiteral(cleanId) : '';\n    const idClause = escapedId ? '(?:[^\\\\s\"<>]*[?&])?id=' + escapedId + '(?=[&#\\\\s\"<>]|$)[^\\\\s\"<>]*' : '[^\\\\s\"<>]+';\n    const rePattern = 'https?:\\\\/\\\\/[a-z0-9.-]*bandcamp\\\\.com\\\\/download\\\\?' + idClause;\n\n    appLog('DEBUG', 'Item \"' + (i?.title || '') + '\" RE', rePattern);\n\n    const obj = {\n      title: i && i.title !== undefined && i.title !== null ? String(i.title) : '',\n      id: i && i.id !== undefined && i.id !== null ? i.id : '',\n      found: false,\n      _cleanId: cleanId,\n      _regexp: new RegExp(rePattern, 'i'),\n      _since: Number(i && i.since) || sinceSec,\n    };\n    if (i && i.since !== undefined && i.since !== null && i.since !== '') {\n      obj.since = i.since;\n    }\n    return obj;\n  });\n\n  appLog('INFO', 'Search Query', query);\n\n  const threads = GmailApp.search(query, 0, MAIL_SEARCH_MAX_THREADS);\n  if (threads.length > 0) {\n    const recentMessages = GmailApp.getMessagesForThreads(threads)\n      .flat()\n      // QUOTA SAVER: Filter out older messages in the thread BEFORE calling getPlainBody()\n      .map((msg) => ({\n        rawMsg: msg,\n        date: Math.floor(msg.getDate().getTime() / 1000),\n      }))\n      .filter((msg) => msg.date >= sinceSec)\n      .sort((a, b) => b.date - a.date);\n\n    let msgIdx = recentMessages.length;\n    appLog('INFO', 'Threads found: ' + threads.length + ', recent messages: ' + msgIdx);\n\n    for (const msg of recentMessages) {\n      const pendingItems = results.filter((i) => !i.found);\n      if (pendingItems.length < 1) break;\n\n      const pendingByTime = pendingItems.filter((i) => i._since <= msg.date);\n      if (pendingByTime.length > 0) {\n        const body = msg.rawMsg.getPlainBody();\n        appLog('DEBUG', 'Matching ' + pendingByTime.length + ' items against message #' + msgIdx + ' (date: ' + msg.date + ')');\n\n        for (const item of pendingByTime) {\n          const match = body.match(item._regexp);\n          if (match) {\n            const dlUrl = match[0].replace(/&amp;/g, '&').trim();\n            appLog('INFO', 'Link found for ' + item.title, dlUrl);\n\n            try {\n              msg.rawMsg.markRead();\n            } catch (e) {}\n\n            item.found = true;\n            item.downloadPageUrl = dlUrl;\n            item.messageId = msg.rawMsg.getId();\n            item.receivedAt = msg.date;\n            break;\n          }\n        }\n      } else {\n        appLog('DEBUG', 'Skipping Message ' + msgIdx + ': too old for remaining items');\n      }\n\n      msgIdx--;\n    }\n  }\n\n  return results.map((r) => {\n    const clean = {\n      id: r.id,\n      title: r.title,\n      found: r.found,\n    };\n    if (r.since !== undefined) clean.since = r.since;\n    if (r.downloadPageUrl) clean.downloadPageUrl = r.downloadPageUrl;\n    if (r.messageId) clean.messageId = r.messageId;\n    if (r.receivedAt) clean.receivedAt = r.receivedAt;\n    return clean;\n  });\n}\n\nfunction enrichArray(items, resultTemplate = {}) {\n  if (!Array.isArray(items) || items.length === 0) {\n    return [{ id: '', title: '', ...resultTemplate }];\n  }\n  return items.map((i) => ({\n    id: i?.id || '',\n    title: i?.title || '',\n    ...resultTemplate,\n  }));\n}\n\nfunction doGet(data) {\n  try {\n    appLog('INFO', 'GET Webhook Invoked');\n    const params = data?.parameter || {};\n    const item = {\n      id: params.id || '',\n      title: decodeURIComponent((params.title || '').replace(/\\+/g, ' ')),\n      since: params.since,\n    };\n    const results = doItemsSearch(params, [item]);\n    return createJsonResponse(results[0] || { found: false });\n  } catch (err) {\n    const errorStr = err.toString();\n    appLog('ERROR', 'GET processing error', errorStr);\n    return createJsonResponse({\n      found: false,\n      error: errorStr,\n    });\n  }\n}\n\nfunction doPost(data) {\n  try {\n    appLog('INFO', 'POST Webhook Invoked');\n    const rawBody = data?.postData?.contents || '[]';\n    appLog('DEBUG', 'Body', rawBody);\n\n    const parsedBody = JSON.parse(rawBody);\n    const items = Array.isArray(parsedBody)\n      ? parsedBody\n      : (Array.isArray(parsedBody?.items) ? parsedBody.items : [parsedBody]);\n\n    const params = data?.parameter || {};\n    params.secret =\n      params.secret ||\n      (!Array.isArray(parsedBody) ? parsedBody?.secret : '') ||\n      (items.length > 0 ? items[0]?.secret : '');\n\n    // Find earliest since value across root params, body.since, and per-item since\n    const minItemSince = items.reduce(\n      (minSince, curItem) => {\n        const s = Number(curItem?.since) || 0;\n        if (s <= 0) return minSince;\n        return minSince <= 0 ? s : Math.min(minSince, s);\n      },\n      0\n    );\n    const rootSince = Number((!Array.isArray(parsedBody) ? parsedBody?.since : 0) || params.since) || 0;\n    params.since = (minItemSince > 0 && rootSince > 0)\n      ? Math.min(minItemSince, rootSince)\n      : (minItemSince || rootSince || 0);\n\n    params.test = params.test || (!Array.isArray(parsedBody) ? parsedBody?.test : '');\n\n    const results = doItemsSearch(params, items);\n    return createJsonResponse(results);\n  } catch (err) {\n    const errorStr = err.toString();\n    appLog('ERROR', 'POST processing error', errorStr);\n    return createJsonResponse({\n      found: false,\n      error: errorStr,\n    });\n  }\n}\n\nfunction createJsonResponse(data) {\n  const respString = JSON.stringify(data);\n  appLog('DEBUG', 'Response', respString);\n  return ContentService.createTextOutput(respString).setMimeType(ContentService.MimeType.JSON);\n}\n\n// Structured Logging\nfunction appLog(logLevel, message, value = '') {\n  try {\n    const baseLevel = LOG_LEVELS.indexOf(LOG_LEVEL);\n    const level = LOG_LEVELS.indexOf(logLevel);\n    if (level >= baseLevel) {\n      const valStr = value !== undefined && value !== null ? String(value) : '';\n      const entry = message + (valStr.length > 0 ? ': ' + valStr : '');\n      switch (logLevel) {\n        case 'ERROR':\n          console.error(entry);\n          break;\n        case 'WARN':\n          console.warn(entry);\n          break;\n        case 'INFO':\n          console.info(entry);\n          break;\n        default:\n          console.log(entry);\n      }\n    }\n  } catch (e) {\n    console.error('Failed to write to log: ' + e.toString());\n  }\n}\n";

  document.addEventListener('DOMContentLoaded', () => {
  const defaultFormat = document.getElementById('defaultFormat');
  const createCompanionInfoZip = document.getElementById('createCompanionInfoZip');
  const namingSchema = document.getElementById('namingSchema');
  const fallbackEmail = document.getElementById('fallbackEmail');
  const gasWebhookUrl = document.getElementById('gasWebhookUrl');
  const gasSecret = document.getElementById('gasSecret');
  const gasSearchOffsetHours = document.getElementById('gasSearchOffsetHours');
  const pacingBaseDelay = document.getElementById('pacingBaseDelay');
  const pacingJitter = document.getElementById('pacingJitter');
  const cooldownBatch = document.getElementById('cooldownBatch');
  const cooldownDuration = document.getElementById('cooldownDuration');
  const copyScriptBtn = document.getElementById('copyScriptBtn');
  const saveBtn = document.getElementById('saveBtn');
  const toast = document.getElementById('toast');

  chrome.storage.local.get([
    'defaultFormat',
    'createCompanionInfoZip',
    'namingSchema',
    'fallbackEmail',
    'gasWebhookUrl',
    'gasSecret',
    'gasSearchOffsetHours',
    'pacingBaseDelay',
    'pacingJitter',
    'cooldownBatch',
    'cooldownDuration'
  ], (data) => {
    if (data.defaultFormat) defaultFormat.value = data.defaultFormat;
    if (data.createCompanionInfoZip !== undefined) createCompanionInfoZip.checked = data.createCompanionInfoZip;
    if (data.namingSchema) namingSchema.value = data.namingSchema;
    if (data.fallbackEmail) fallbackEmail.value = data.fallbackEmail;
    if (data.gasWebhookUrl) gasWebhookUrl.value = data.gasWebhookUrl;
    if (data.gasSecret) gasSecret.value = data.gasSecret;
    if (data.gasSearchOffsetHours) gasSearchOffsetHours.value = String(data.gasSearchOffsetHours);
    if (data.pacingBaseDelay !== undefined) pacingBaseDelay.value = data.pacingBaseDelay;
    if (data.pacingJitter !== undefined) pacingJitter.value = data.pacingJitter;
    if (data.cooldownBatch !== undefined) cooldownBatch.value = data.cooldownBatch;
    if (data.cooldownDuration !== undefined) cooldownDuration.value = data.cooldownDuration;
  });

  copyScriptBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(GAS_CODE_GS);
    toast.textContent = '✓ Copied Code.gs template to clipboard!';
    toast.style.display = 'block';
    setTimeout(() => { toast.style.display = 'none'; }, 3000);
  });

  saveBtn.addEventListener('click', () => {
    chrome.storage.local.set({
      defaultFormat: defaultFormat.value,
      createCompanionInfoZip: createCompanionInfoZip.checked,
      namingSchema: namingSchema.value,
      fallbackEmail: fallbackEmail.value,
      gasWebhookUrl: gasWebhookUrl.value.trim(),
      gasSecret: gasSecret.value.trim(),
      gasSearchOffsetHours: parseInt(gasSearchOffsetHours.value, 10) || 72,
      pacingBaseDelay: parseFloat(pacingBaseDelay.value) || 2.5,
      pacingJitter: parseInt(pacingJitter.value, 10) || 40,
      cooldownBatch: parseInt(cooldownBatch.value, 10) || 5,
      cooldownDuration: parseInt(cooldownDuration.value, 10) || 12
    }, () => {
      toast.textContent = '✓ Preferences saved successfully!';
      toast.style.display = 'block';
      setTimeout(() => { toast.style.display = 'none'; }, 3000);
    });
  });
});
})();
