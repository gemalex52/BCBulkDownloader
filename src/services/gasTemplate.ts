export const GAS_SCRIPT_TEMPLATE = `/**
 * Bandcamp Bulk Downloader - Gmail Watchdog Webhook (Google Apps Script)
 * Supports batched JSON POST lookups with root secret/since/test and per-item title/id/since.
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

var SECRET_PASSWORD = 'CHANGE_THIS_SECRET_PASSWORD';

function buildGmailQuery(sinceSeconds) {
  var query = 'from:bandcamp.com OR subject:Bandcamp';
  if (sinceSeconds > 0) {
    // 1-day cushion on Gmail's coarse YYYY/MM/DD date filter to prevent timezone boundary misses;
    // exact epoch filtering is applied in matchItemInMessages().
    var searchDate = new Date((sinceSeconds - 86400) * 1000);
    var year = searchDate.getFullYear();
    var month = ('0' + (searchDate.getMonth() + 1)).slice(-2);
    var day = ('0' + searchDate.getDate()).slice(-2);
    query += ' after:' + year + '/' + month + '/' + day;
  }
  return query;
}

function extractBandcampDownloadUrls(body) {
  var urlsFound = [];
  var seen = {};

  function pushUrl(raw) {
    if (!raw) return;
    var clean = String(raw).replace(/&amp;/g, '&').trim();
    if (clean && !seen[clean]) {
      seen[clean] = true;
      urlsFound.push(clean);
    }
  }

  // Pattern A: Match in HTML href attributes
  var hrefRegex = /href=["'](https?:\\/\\/[^"']*(?:bandcamp\\.com)\\/download\\?[^"']+)["']/gi;
  var hrefMatch;
  while ((hrefMatch = hrefRegex.exec(body)) !== null) {
    pushUrl(hrefMatch[1]);
  }

  // Pattern B: Match raw text URLs
  var textRegex = /https?:\\/\\/[a-zA-Z0-9.-]*bandcamp\\.com\\/download\\?[a-zA-Z0-9_=&;.~%-]+/gi;
  var textMatches = body.match(textRegex);
  if (textMatches) {
    for (var t = 0; t < textMatches.length; t++) {
      pushUrl(textMatches[t]);
    }
  }

  return urlsFound;
}

function extractCandidateMessages(query, minSinceSeconds, maxThreads) {
  var threads = GmailApp.search(query, 0, maxThreads || 100);
  var scanned = [];

  for (var i = 0; i < threads.length; i++) {
    var messages = threads[i].getMessages();
    for (var j = messages.length - 1; j >= 0; j--) {
      var msg = messages[j];
      var msgDate = msg.getDate();
      var msgEpoch = Math.floor(msgDate.getTime() / 1000);

      if (minSinceSeconds > 0 && msgEpoch < (minSinceSeconds - 30)) {
        continue;
      }

      var body = msg.getBody() + ' ' + msg.getPlainBody();
      var subject = msg.getSubject() || '';
      var urlsFound = extractBandcampDownloadUrls(body);

      if (urlsFound.length > 0) {
        scanned.push({
          msgEpoch: msgEpoch,
          subject: subject,
          cleanSubject: subject.toLowerCase().replace(/[^a-z0-9]/g, ''),
          messageId: msg.getId(),
          body: body,
          cleanBody: body.toLowerCase().replace(/[^a-z0-9]/g, ''),
          urls: urlsFound
        });
      }
    }
  }

  return scanned;
}

function matchItemInMessages(item, rootSince, scannedMessages) {
  var rawId = item && item.id !== undefined && item.id !== null ? item.id : '';
  var title = item && item.title !== undefined && item.title !== null ? String(item.title).trim() : '';
  var hasItemSince = item && item.since !== undefined && item.since !== null && item.since !== '';
  var effectiveSince = hasItemSince ? (parseInt(item.since, 10) || 0) : (parseInt(rootSince, 10) || 0);
  var cleanReleaseId = String(rawId).replace(/^(album|track)-/, '').trim();

  var cleanBaseTitle = '';
  if (title) {
    var baseTitle = title.replace(/\\s*\\([^)]*\\)/g, '').replace(/\\s*\\[[^\\]]*\\]/g, '').trim();
    cleanBaseTitle = baseTitle.toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  var baseResp = {
    title: title,
    id: rawId
  };
  if (hasItemSince) {
    baseResp.since = item.since;
  }

  for (var i = 0; i < scannedMessages.length; i++) {
    var rec = scannedMessages[i];
    if (effectiveSince > 0 && rec.msgEpoch < (effectiveSince - 30)) {
      continue;
    }

    var titleMatches = Boolean(
      cleanBaseTitle.length > 2 &&
      (rec.cleanSubject.indexOf(cleanBaseTitle) !== -1 || rec.cleanBody.indexOf(cleanBaseTitle) !== -1)
    );

    // Prefer a URL whose query explicitly carries id=<cleanReleaseId>
    var matchedUrl = '';
    for (var k = 0; k < rec.urls.length; k++) {
      var u = rec.urls[k];
      if (cleanReleaseId && u.indexOf('id=' + cleanReleaseId) !== -1) {
        matchedUrl = u;
        break;
      }
    }

    if (!matchedUrl) {
      var hasBodyId = Boolean(cleanReleaseId && rec.body.indexOf(cleanReleaseId) !== -1);
      var isMatch = cleanReleaseId ? (hasBodyId || titleMatches) : (title ? titleMatches : true);
      if (isMatch && rec.urls.length > 0) {
        matchedUrl = rec.urls[0];
      }
    }

    if (matchedUrl) {
      baseResp.found = true;
      baseResp.downloadPageUrl = matchedUrl;
      baseResp.messageId = rec.messageId;
      baseResp.receivedAt = rec.msgEpoch;
      return baseResp;
    }
  }

  baseResp.found = false;
  return baseResp;
}

function buildErrorArray(items, errMsg) {
  if (Array.isArray(items) && items.length > 0) {
    return items.map(function(it) {
      var obj = {
        title: it && it.title !== undefined && it.title !== null ? String(it.title) : '',
        id: it && it.id !== undefined && it.id !== null ? it.id : '',
        found: false,
        error: errMsg
      };
      if (it && it.since !== undefined && it.since !== null && it.since !== '') {
        obj.since = it.since;
      }
      return obj;
    });
  }
  return [{ found: false, error: errMsg }];
}

function doGet(e) {
  try {
    var params = e && e.parameter ? e.parameter : {};
    var clientSecret = params.secret || '';

    if (!clientSecret || clientSecret !== SECRET_PASSWORD) {
      return createJsonResponse({
        found: false,
        error: 'Unauthorized: Invalid or missing secret password'
      });
    }

    if (params.test === 'true') {
      return createJsonResponse({
        found: false,
        test: true,
        batchSupported: true,
        message: 'Google Apps Script Webhook is active (POST batch mode enabled) and authorized successfully!'
      });
    }

    var sinceSeconds = parseInt(params.since, 10) || 0;
    var query = buildGmailQuery(sinceSeconds);
    var scannedMessages = extractCandidateMessages(query, sinceSeconds, 50);
    return createJsonResponse(matchItemInMessages({ id: params.id || '', title: params.title || '', since: params.since }, sinceSeconds, scannedMessages));
  } catch (err) {
    return createJsonResponse({
      found: false,
      error: err.toString()
    });
  }
}

function doPost(e) {
  var items = [];
  try {
    var params = e && e.parameter ? e.parameter : {};
    var rawBody = e && e.postData && e.postData.contents ? e.postData.contents : '{}';
    var parsed = JSON.parse(rawBody);

    var isArrayPayload = Array.isArray(parsed);
    items = isArrayPayload
      ? parsed
      : (parsed && Array.isArray(parsed.items) ? parsed.items : []);

    var clientSecret = (!isArrayPayload && parsed && parsed.secret) ? String(parsed.secret) : (params.secret || '');
    var rootSince = (!isArrayPayload && parsed && parsed.since !== undefined && parsed.since !== null)
      ? (parseInt(parsed.since, 10) || 0)
      : 0;
    var isTest = params.test === 'true' || (!isArrayPayload && parsed && parsed.test === true);

    if (!clientSecret || clientSecret !== SECRET_PASSWORD) {
      return createJsonResponse(buildErrorArray(items, 'Unauthorized: Invalid or missing secret password'));
    }

    if (isTest) {
      return createJsonResponse({
        found: false,
        test: true,
        batchSupported: true,
        message: 'Google Apps Script POST Batch Webhook is active and authorized!'
      });
    }

    if (items.length === 0) {
      return createJsonResponse([]);
    }

    // Compute earliest since cutoff across items and rootSince for a single GmailApp.search call
    var earliestSince = 0;
    var hasUnbounded = false;
    for (var idx = 0; idx < items.length; idx++) {
      var it = items[idx] || {};
      var itSince = (it.since !== undefined && it.since !== null && it.since !== '')
        ? (parseInt(it.since, 10) || 0)
        : rootSince;
      if (itSince <= 0) {
        hasUnbounded = true;
      } else if (earliestSince === 0 || itSince < earliestSince) {
        earliestSince = itSince;
      }
    }

    var effectiveSince = hasUnbounded ? 0 : earliestSince;
    var query = buildGmailQuery(effectiveSince);
    var scannedMessages = extractCandidateMessages(query, effectiveSince, 100);

    var results = [];
    for (var k = 0; k < items.length; k++) {
      results.push(matchItemInMessages(items[k] || {}, rootSince, scannedMessages));
    }

    return createJsonResponse(results);
  } catch (err) {
    return createJsonResponse(buildErrorArray(items, err.toString()));
  }
}

function createJsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
`;
