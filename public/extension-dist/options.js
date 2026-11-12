(function() {
  'use strict';
  // Bandcamp Bulk Downloader - Options Script
  const GAS_CODE_GS = "/**\n * Bandcamp Bulk Downloader - Gmail Watchdog Webhook (Google Apps Script)\n * \n * INSTRUCTIONS:\n * 1. Open https://script.google.com and click \"New Project\".\n * 2. Paste this entire script into Code.gs (replacing everything).\n * 3. Change SECRET_PASSWORD below to your own secret key (e.g. 'my_bandcamp_secret_2026').\n * 4. Click Deploy -> New deployment.\n * 5. Click the gear icon next to \"Select type\" and choose \"Web app\".\n * 6. Set \"Execute as\" = \"Me (<your email>)\" and \"Who has access\" = \"Anyone\".\n * 7. Click Deploy, Authorize access, and copy the Web App URL (starts with https://script.google.com/macros/s/...).\n * 8. Paste the Web App URL and Secret Password into the Bulk Downloader settings.\n */\n\nvar SECRET_PASSWORD = 'CHANGE_THIS_SECRET_PASSWORD';\n\nfunction doGet(e) {\n  try {\n    var params = e && e.parameter ? e.parameter : {};\n    var clientSecret = params.secret || '';\n    \n    // 1. Authorize with secret password\n    if (!clientSecret || clientSecret !== SECRET_PASSWORD) {\n      return createJsonResponse({ \n        found: false, \n        error: 'Unauthorized: Invalid or missing secret password parameter' \n      });\n    }\n    \n    // Quick test ping\n    if (params.test === 'true') {\n      return createJsonResponse({\n        found: false,\n        test: true,\n        message: 'Google Apps Script Webhook is active and authorized successfully!'\n      });\n    }\n    \n    var releaseId = params.id ? String(params.id).trim() : '';\n    var title = params.title ? String(params.title).trim() : '';\n    var cleanReleaseId = releaseId ? releaseId.replace(/^(album|track)-/, '') : '';\n    \n    // Calculate cutoff timestamp based on user parameters (since, hours, days, startDate)\n    var sinceSeconds = 0;\n    if (params.since) {\n      sinceSeconds = parseInt(params.since, 10) || 0;\n    } else if (params.hours) {\n      var h = parseFloat(params.hours) || 24;\n      sinceSeconds = Math.floor(Date.now() / 1000) - Math.floor(h * 3600);\n    } else if (params.days) {\n      var d = parseFloat(params.days) || 3;\n      sinceSeconds = Math.floor(Date.now() / 1000) - Math.floor(d * 86400);\n    } else if (params.startDate) {\n      var parsedDate = new Date(params.startDate);\n      if (!isNaN(parsedDate.getTime())) {\n        sinceSeconds = Math.floor(parsedDate.getTime() / 1000);\n      }\n    }\n    \n    // 2. Query Gmail efficiently using after: date filter\n    var query = 'from:bandcamp.com OR subject:Bandcamp';\n    if (sinceSeconds > 0) {\n      // 10 min grace window\n      var searchDate = new Date((sinceSeconds - 600) * 1000);\n      var year = searchDate.getFullYear();\n      var month = ('0' + (searchDate.getMonth() + 1)).slice(-2);\n      var day = ('0' + searchDate.getDate()).slice(-2);\n      query += ' after:' + year + '/' + month + '/' + day;\n    }\n    \n    var threads = GmailApp.search(query, 0, 50);\n    \n    for (var i = 0; i < threads.length; i++) {\n      var messages = threads[i].getMessages();\n      for (var j = messages.length - 1; j >= 0; j--) {\n        var msg = messages[j];\n        var msgDate = msg.getDate();\n        var msgEpoch = Math.floor(msgDate.getTime() / 1000);\n        \n        if (sinceSeconds > 0 && msgEpoch < (sinceSeconds - 600)) {\n          continue;\n        }\n        \n        var body = msg.getBody() + ' ' + msg.getPlainBody();\n        var subject = msg.getSubject() || '';\n        \n        // 3. Extract signed Bandcamp download link (DO NOT strip query params with &)\n        var urlsFound = [];\n        \n        // Pattern A: Match in HTML href attributes\n        var hrefRegex = /href=[\"'](https?://[^\"']*(?:bandcamp.com)/download?[^\"']+)[\"']/gi;\n        var hrefMatch;\n        while ((hrefMatch = hrefRegex.exec(body)) !== null) {\n          urlsFound.push(hrefMatch[1]);\n        }\n        \n        // Pattern B: Match raw text URLs\n        var textRegex = /https?://[a-zA-Z0-9.-]*bandcamp.com/download?[a-zA-Z0-9_=&;.~%-]+/gi;\n        var textMatches = body.match(textRegex);\n        if (textMatches) {\n          for (var t = 0; t < textMatches.length; t++) {\n            urlsFound.push(textMatches[t]);\n          }\n        }\n        \n        if (urlsFound.length > 0) {\n          for (var k = 0; k < urlsFound.length; k++) {\n            var rawUrl = urlsFound[k].replace(/&amp;/g, '&').trim();\n            \n            // Check if matches releaseId or clean numeric ID\n            var hasId = Boolean(cleanReleaseId && (rawUrl.indexOf('id=' + cleanReleaseId) !== -1 || body.indexOf(cleanReleaseId) !== -1));\n            \n            // Check if matches title if provided (support titles with parenthetical years/subtitles)\n            var titleMatches = false;\n            if (title) {\n              var baseTitle = title.replace(/s*([^)]*)/g, '').replace(/s*[[^]]*]/g, '').trim();\n              var cleanBaseTitle = baseTitle.toLowerCase().replace(/[^a-z0-9]/g, '');\n              var cleanSubject = subject.toLowerCase().replace(/[^a-z0-9]/g, '');\n              var cleanBody = body.toLowerCase().replace(/[^a-z0-9]/g, '');\n              titleMatches = (cleanBaseTitle.length > 2 && (cleanSubject.indexOf(cleanBaseTitle) !== -1 || cleanBody.indexOf(cleanBaseTitle) !== -1));\n            }\n            \n            var isMatch = cleanReleaseId ? (hasId || titleMatches) : (title ? titleMatches : true);\n            \n            if (isMatch) {\n              return createJsonResponse({\n                found: true,\n                downloadPageUrl: rawUrl,\n                subject: subject,\n                receivedAt: msgEpoch,\n                messageId: msg.getId()\n              });\n            }\n          }\n        }\n      }\n    }\n    \n    return createJsonResponse({\n      found: false,\n      message: 'No matching Bandcamp email found yet',\n      query: query,\n      checkedThreads: threads.length\n    });\n  } catch (err) {\n    return createJsonResponse({ \n      found: false, \n      error: err.toString() \n    });\n  }\n}\n\nfunction createJsonResponse(data) {\n  return ContentService.createTextOutput(JSON.stringify(data))\n    .setMimeType(ContentService.MimeType.JSON);\n}\n";

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
