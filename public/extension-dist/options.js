(function() {
  'use strict';
  // Bandcamp Bulk Downloader - Options Script
  const GAS_CODE_GS = "/**\n * Bandcamp Bulk Downloader - Gmail Watchdog Webhook (Google Apps Script)\n * Supports batched JSON POST lookups with root secret/since/test and per-item title/id/since.\n *\n * INSTRUCTIONS:\n * 1. Open https://script.google.com and click \"New Project\" (or open existing project).\n * 2. Paste this entire script into Code.gs (replacing everything).\n * 3. Change SECRET_PASSWORD below to your own secret key (e.g. 'my_bandcamp_secret_2026').\n * 4. Click Deploy -> New deployment (or Manage deployments -> Edit -> New version).\n * 5. Select type \"Web app\", set \"Execute as\" = \"Me (<your email>)\" and \"Who has access\" = \"Anyone\".\n * 6. Click Deploy, Authorize access, and copy the Web App URL (https://script.google.com/macros/s/.../exec).\n * 7. Paste the Web App URL and Secret Password into the Bulk Downloader settings.\n */\n\nvar SECRET_PASSWORD = 'CHANGE_THIS_SECRET_PASSWORD';\n\nfunction buildGmailQuery(sinceSeconds) {\n  var query = 'from:bandcamp.com OR subject:Bandcamp';\n  if (sinceSeconds > 0) {\n    // 1-day cushion on Gmail's coarse YYYY/MM/DD date filter to prevent timezone boundary misses;\n    // exact epoch filtering is applied in matchItemInMessages().\n    var searchDate = new Date((sinceSeconds - 86400) * 1000);\n    var year = searchDate.getFullYear();\n    var month = ('0' + (searchDate.getMonth() + 1)).slice(-2);\n    var day = ('0' + searchDate.getDate()).slice(-2);\n    query += ' after:' + year + '/' + month + '/' + day;\n  }\n  return query;\n}\n\nfunction extractBandcampDownloadUrls(body) {\n  var urlsFound = [];\n  var seen = {};\n\n  function pushUrl(raw) {\n    if (!raw) return;\n    var clean = String(raw).replace(/&amp;/g, '&').trim();\n    if (clean && !seen[clean]) {\n      seen[clean] = true;\n      urlsFound.push(clean);\n    }\n  }\n\n  // Pattern A: Match in HTML href attributes\n  var hrefRegex = /href=[\"'](https?:\\/\\/[^\"']*(?:bandcamp\\.com)\\/download\\?[^\"']+)[\"']/gi;\n  var hrefMatch;\n  while ((hrefMatch = hrefRegex.exec(body)) !== null) {\n    pushUrl(hrefMatch[1]);\n  }\n\n  // Pattern B: Match raw text URLs\n  var textRegex = /https?:\\/\\/[a-zA-Z0-9.-]*bandcamp\\.com\\/download\\?[a-zA-Z0-9_=&;.~%-]+/gi;\n  var textMatches = body.match(textRegex);\n  if (textMatches) {\n    for (var t = 0; t < textMatches.length; t++) {\n      pushUrl(textMatches[t]);\n    }\n  }\n\n  return urlsFound;\n}\n\nfunction extractCandidateMessages(query, minSinceSeconds, maxThreads) {\n  var threads = GmailApp.search(query, 0, maxThreads || 100);\n  var scanned = [];\n\n  for (var i = 0; i < threads.length; i++) {\n    var messages = threads[i].getMessages();\n    for (var j = messages.length - 1; j >= 0; j--) {\n      var msg = messages[j];\n      var msgDate = msg.getDate();\n      var msgEpoch = Math.floor(msgDate.getTime() / 1000);\n\n      if (minSinceSeconds > 0 && msgEpoch < (minSinceSeconds - 30)) {\n        continue;\n      }\n\n      var body = msg.getBody() + ' ' + msg.getPlainBody();\n      var subject = msg.getSubject() || '';\n      var urlsFound = extractBandcampDownloadUrls(body);\n\n      if (urlsFound.length > 0) {\n        scanned.push({\n          msgEpoch: msgEpoch,\n          subject: subject,\n          cleanSubject: subject.toLowerCase().replace(/[^a-z0-9]/g, ''),\n          messageId: msg.getId(),\n          body: body,\n          cleanBody: body.toLowerCase().replace(/[^a-z0-9]/g, ''),\n          urls: urlsFound\n        });\n      }\n    }\n  }\n\n  return scanned;\n}\n\nfunction matchItemInMessages(item, rootSince, scannedMessages) {\n  var rawId = item && item.id !== undefined && item.id !== null ? item.id : '';\n  var title = item && item.title !== undefined && item.title !== null ? String(item.title).trim() : '';\n  var hasItemSince = item && item.since !== undefined && item.since !== null && item.since !== '';\n  var effectiveSince = hasItemSince ? (parseInt(item.since, 10) || 0) : (parseInt(rootSince, 10) || 0);\n  var cleanReleaseId = String(rawId).replace(/^(album|track)-/, '').trim();\n\n  var cleanBaseTitle = '';\n  if (title) {\n    var baseTitle = title.replace(/\\s*\\([^)]*\\)/g, '').replace(/\\s*\\[[^\\]]*\\]/g, '').trim();\n    cleanBaseTitle = baseTitle.toLowerCase().replace(/[^a-z0-9]/g, '');\n  }\n\n  var baseResp = {\n    title: title,\n    id: rawId\n  };\n  if (hasItemSince) {\n    baseResp.since = item.since;\n  }\n\n  for (var i = 0; i < scannedMessages.length; i++) {\n    var rec = scannedMessages[i];\n    if (effectiveSince > 0 && rec.msgEpoch < (effectiveSince - 30)) {\n      continue;\n    }\n\n    var titleMatches = Boolean(\n      cleanBaseTitle.length > 2 &&\n      (rec.cleanSubject.indexOf(cleanBaseTitle) !== -1 || rec.cleanBody.indexOf(cleanBaseTitle) !== -1)\n    );\n\n    // Prefer a URL whose query explicitly carries id=<cleanReleaseId>\n    var matchedUrl = '';\n    for (var k = 0; k < rec.urls.length; k++) {\n      var u = rec.urls[k];\n      if (cleanReleaseId && u.indexOf('id=' + cleanReleaseId) !== -1) {\n        matchedUrl = u;\n        break;\n      }\n    }\n\n    if (!matchedUrl) {\n      var hasBodyId = Boolean(cleanReleaseId && rec.body.indexOf(cleanReleaseId) !== -1);\n      var isMatch = cleanReleaseId ? (hasBodyId || titleMatches) : (title ? titleMatches : true);\n      if (isMatch && rec.urls.length > 0) {\n        matchedUrl = rec.urls[0];\n      }\n    }\n\n    if (matchedUrl) {\n      baseResp.found = true;\n      baseResp.downloadPageUrl = matchedUrl;\n      baseResp.messageId = rec.messageId;\n      baseResp.receivedAt = rec.msgEpoch;\n      return baseResp;\n    }\n  }\n\n  baseResp.found = false;\n  return baseResp;\n}\n\nfunction buildErrorArray(items, errMsg) {\n  if (Array.isArray(items) && items.length > 0) {\n    return items.map(function(it) {\n      var obj = {\n        title: it && it.title !== undefined && it.title !== null ? String(it.title) : '',\n        id: it && it.id !== undefined && it.id !== null ? it.id : '',\n        found: false,\n        error: errMsg\n      };\n      if (it && it.since !== undefined && it.since !== null && it.since !== '') {\n        obj.since = it.since;\n      }\n      return obj;\n    });\n  }\n  return [{ found: false, error: errMsg }];\n}\n\nfunction doGet(e) {\n  try {\n    var params = e && e.parameter ? e.parameter : {};\n    var clientSecret = params.secret || '';\n\n    if (!clientSecret || clientSecret !== SECRET_PASSWORD) {\n      return createJsonResponse({\n        found: false,\n        error: 'Unauthorized: Invalid or missing secret password'\n      });\n    }\n\n    if (params.test === 'true') {\n      return createJsonResponse({\n        found: false,\n        test: true,\n        batchSupported: true,\n        message: 'Google Apps Script Webhook is active (POST batch mode enabled) and authorized successfully!'\n      });\n    }\n\n    var sinceSeconds = parseInt(params.since, 10) || 0;\n    var query = buildGmailQuery(sinceSeconds);\n    var scannedMessages = extractCandidateMessages(query, sinceSeconds, 50);\n    return createJsonResponse(matchItemInMessages({ id: params.id || '', title: params.title || '', since: params.since }, sinceSeconds, scannedMessages));\n  } catch (err) {\n    return createJsonResponse({\n      found: false,\n      error: err.toString()\n    });\n  }\n}\n\nfunction doPost(e) {\n  var items = [];\n  try {\n    var params = e && e.parameter ? e.parameter : {};\n    var rawBody = e && e.postData && e.postData.contents ? e.postData.contents : '{}';\n    var parsed = JSON.parse(rawBody);\n\n    var isArrayPayload = Array.isArray(parsed);\n    items = isArrayPayload\n      ? parsed\n      : (parsed && Array.isArray(parsed.items) ? parsed.items : []);\n\n    var clientSecret = (!isArrayPayload && parsed && parsed.secret) ? String(parsed.secret) : (params.secret || '');\n    var rootSince = (!isArrayPayload && parsed && parsed.since !== undefined && parsed.since !== null)\n      ? (parseInt(parsed.since, 10) || 0)\n      : 0;\n    var isTest = params.test === 'true' || (!isArrayPayload && parsed && parsed.test === true);\n\n    if (!clientSecret || clientSecret !== SECRET_PASSWORD) {\n      return createJsonResponse(buildErrorArray(items, 'Unauthorized: Invalid or missing secret password'));\n    }\n\n    if (isTest) {\n      return createJsonResponse({\n        found: false,\n        test: true,\n        batchSupported: true,\n        message: 'Google Apps Script POST Batch Webhook is active and authorized!'\n      });\n    }\n\n    if (items.length === 0) {\n      return createJsonResponse([]);\n    }\n\n    // Compute earliest since cutoff across items and rootSince for a single GmailApp.search call\n    var earliestSince = 0;\n    var hasUnbounded = false;\n    for (var idx = 0; idx < items.length; idx++) {\n      var it = items[idx] || {};\n      var itSince = (it.since !== undefined && it.since !== null && it.since !== '')\n        ? (parseInt(it.since, 10) || 0)\n        : rootSince;\n      if (itSince <= 0) {\n        hasUnbounded = true;\n      } else if (earliestSince === 0 || itSince < earliestSince) {\n        earliestSince = itSince;\n      }\n    }\n\n    var effectiveSince = hasUnbounded ? 0 : earliestSince;\n    var query = buildGmailQuery(effectiveSince);\n    var scannedMessages = extractCandidateMessages(query, effectiveSince, 100);\n\n    var results = [];\n    for (var k = 0; k < items.length; k++) {\n      results.push(matchItemInMessages(items[k] || {}, rootSince, scannedMessages));\n    }\n\n    return createJsonResponse(results);\n  } catch (err) {\n    return createJsonResponse(buildErrorArray(items, err.toString()));\n  }\n}\n\nfunction createJsonResponse(data) {\n  return ContentService.createTextOutput(JSON.stringify(data))\n    .setMimeType(ContentService.MimeType.JSON);\n}\n";

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
