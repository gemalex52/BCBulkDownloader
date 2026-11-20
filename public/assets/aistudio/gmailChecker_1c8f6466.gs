
const LOG_LEVELS = ["DEBUG", "INFO", "WARN", "ERROR"];
const LOG_LEVEL = "INFO";

const MAIL_SEARCH_LOOKBACK_SEC = 5; // by default, start looking for mails received from 5 seconds before now 
const MAIL_SEARCH_MAX_THREADS = 50; // by default, return 50 matching threads max

const SECRET_PASSWORD = 'CHANGE_THIS_SECRET_PASSWORD';

function doItemsSearch(params, items) {

  appLog("INFO", "Params", JSON.stringify(params));

  // authorize
  if (params.secret !== SECRET_PASSWORD) {
    appLog("WARN", "Wrong secret: ", secret);
    return enrichArray(items, {
        found: false,
        error: 'Unauthorized: Invalid or missing password parameter'
    });
  }

  // ping
  if (params.test === 'true') {
    appLog("INFO", "Test OK");
    return enrichArray(items, {
      found: false,
      test: true,
      batchSupported: true,
      serverTime: Math.floor(Date.now() / 1000),
      message: 'GAS Webhook (POST-enabled) is active and authorized successfully!'
    });
  }

  // build emails matching command
  let query = `from:bandcamp.com "bandcamp.com/download"`;
  const sinceSec = params.since || Math.floor(Date.now() / 1000 - MAIL_SEARCH_LOOKBACK_SEC)
  query += ` after:${sinceSec}`;

  const searchQuery = query;
  // prepare out array with pre-created regexp object
  let results = items.map(i => {
    const idClause = i.id ? `[^\\s"<>]+id=${i.id}` : '';
    const re = `https:\/\/bandcamp\.com\/download\?${idClause}[^\\s"<>]+`;

    appLog("DEBUG", `Item "${i.title}" RE`, re);

    return {
      ...i, 
      found: false,
      regexp: new RegExp(re, "i")
    }
  });

  appLog("INFO", "Search Query", searchQuery);

  const threads = GmailApp.search(searchQuery, 0, MAIL_SEARCH_MAX_THREADS);
  if (threads.length > 0) {

    const recentMessages = GmailApp.getMessagesForThreads(threads)
        .flat()
        // QUOTA SAVER: Filter out older messages in the thread BEFORE calling getPlainBody()
        .map((msg) => ({ 
          rawMsg: msg, 
          date: Math.floor(msg.getDate().getTime() / 1000) 
        }))
        .filter((msg) => msg.date >= sinceSec)
        .sort((a, b) => b.date - a.date);

    let msgIdx = recentMessages?.length;

    appLog("INFO", "Threads found: " + threads?.length + ", total recent messages: " + msgIdx);

    for (const msg of recentMessages) {

      const pendingItems = results.filter(i => !i.found);
      if (pendingItems.length < 1)
        return results;

      const pendingByTime = pendingItems.filter(i => (i.since || sinceSec) < msg.date);

      if (pendingByTime.length > 0) {

        const body = msg.rawMsg.getPlainBody();
        appLog("DEBUG", "Matching " + pendingByTime.length + " items against message #" + msgIdx + " body (date: " + msg.date + ")", body);

        for (let item of pendingByTime) {

          const match = body.match(item.regexp);

          let lookupResult = "Looking for '" + item.title + "': ";
          
          if (match) {

            lookupResult += "FOUND";

            const dlUrl = match[0].replace(/&amp;/g, "&");

            appLog("INFO", "Link found for " + item.title, dlUrl);
            
            // optionally mark as read
            msg.rawMsg.markRead();
            //thread.moveToArchive();

            item.found = true;
            item.downloadPageUrl = dlUrl;
            item.messageId = msg.rawMsg.getId();
            item.receivedAt = msg.date;
            
            // stop items loop, this message is done
            break;

          } else {
            lookupResult += "No match";
          }

          appLog("DEBUG", lookupResult);

        }

      } else {
        appLog("DEBUG", "Skipping Message " + msgIdx + ": too old for the remaining items");
      }

      msgIdx--;
    }
  }

  return results;
}

function enrichArray(items, resultTemplate = {}) {
  if (!Array.isArray(items)) return [];
  return items.map((i) => ({
    id: i?.id || '', relaseId: i?.relaseId || '', title: i?.title || '', ...resultTemplate
  }));
}

function doGet(data) {

  try {
  
    appLog("INFO", "GET Webhook Invoked", data.query);

    const params = data?.parameter || {};
    const item = {id: params.id, title: decodeURIComponent((params.title || '').replace(/\+/g, ' ')), since: params.since };
    const results = doItemsSearch(params, [item]);

    return createJsonResponse(results[0]);

  } catch (err) {

    var errorStr = err.toString();
    appLog("ERROR", "GET processing error", errorStr);
    return createJsonResponse({
      found: false,
      error: errorStr
    });

  }
}

function doPost(data) {

  try {

    appLog("INFO", "POST Webhook Invoked", data?.query);

    const rawBody = data?.postData?.contents || '[]';

    appLog("DEBUG", "Body", rawBody);

    const parsedBody = JSON.parse(rawBody);
    const items = Array.isArray(parsedBody) ? parsedBody : (Array.isArray(parsedBody?.items) ? parsedBody.items : [parsedBody]);

    var params = data?.parameter || {};
    params.secret = params.secret || (!Array.isArray(parsedBody) ? parsedBody?.secret : '') || (items.length > 0 ? items[0]?.secret : '');
    // find the earliest since value (or just use 10 sec lookback)
    params.since = earliestSince = items.reduce(
      (minSince, curItem) => Math.min(curItem?.since || minSince, minSince || curItem?.since) || 0,
      Math.min(parsedBody?.since || params.since, params.since || parsedBody?.since) || 0
    ) || 0;
    params.test = params.test || (!Array.isArray(parsedBody) ? parsedBody?.test : '');

    const results = doItemsSearch(params, items);

    return createJsonResponse(results);

  } catch (err) {

    var errorStr = err.toString();
    appLog("ERROR", "POST processing error", errorStr);
    return createJsonResponse({
      found: false,
      error: errorStr
    });

  }
}

function createJsonResponse(data) {
  const respString = JSON.stringify(data);
  appLog("DEBUG", "Response", respString);
  return ContentService.createTextOutput(respString).setMimeType(ContentService.MimeType.JSON);
}


// Logging

function appLog(logLevel, message, value = "") {
  try {
    const baseLevel = LOG_LEVELS.indexOf(LOG_LEVEL);
    const level = LOG_LEVELS.indexOf(logLevel);
    if (level >= baseLevel) {
        const entry = message + (value && value.length > 0 ? `: ${value}` : "");
        switch (logLevel) {
          case "ERROR":
            console.error(entry);
            break;
          case "WARN":
            console.warn(entry);
            break;
          case "INFO":
            console.info(entry);
            break;
          default:
            console.log(entry);
        }
    }
  } catch (e) {
    console.error("Failed to write to log: " + e.toString());
  }
}

