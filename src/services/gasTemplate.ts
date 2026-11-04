export const GAS_SCRIPT_TEMPLATE = `/**
 * Bandcamp Bulk Downloader - Gmail Watchdog Webhook (Google Apps Script)
 * 
 * INSTRUCTIONS:
 * 1. Open https://script.google.com and click "New Project".
 * 2. Paste this entire script into Code.gs (replacing everything).
 * 3. Change SECRET_PASSWORD below to your own secret key (e.g. 'my_bandcamp_secret_2026').
 * 4. Click Deploy -> New deployment.
 * 5. Click the gear icon next to "Select type" and choose "Web app".
 * 6. Set "Execute as" = "Me (<your email>)" and "Who has access" = "Anyone".
 * 7. Click Deploy, Authorize access, and copy the Web App URL (starts with https://script.google.com/macros/s/...).
 * 8. Paste the Web App URL and Secret Password into the Bulk Downloader settings.
 */

var SECRET_PASSWORD = 'CHANGE_THIS_SECRET_PASSWORD';

function doGet(e) {
  try {
    var params = e && e.parameter ? e.parameter : {};
    var clientSecret = params.secret || '';
    
    // 1. Authorize with secret password
    if (!clientSecret || clientSecret !== SECRET_PASSWORD) {
      return createJsonResponse({ 
        found: false, 
        error: 'Unauthorized: Invalid or missing secret password parameter' 
      });
    }
    
    // Quick test ping
    if (params.test === 'true') {
      return createJsonResponse({
        found: false,
        test: true,
        message: 'Google Apps Script Webhook is active and authorized successfully!'
      });
    }
    
    var releaseId = params.id ? String(params.id).trim() : '';
    var title = params.title ? String(params.title).trim() : '';
    var cleanReleaseId = releaseId ? releaseId.replace(/^(album|track)-/, '') : '';
    
    // 2. Query Gmail efficiently using after: date filter
    var query = 'from:noreply@bandcamp.com';
    if (sinceSeconds > 0) {
      // 10 min grace window
      var searchDate = new Date((sinceSeconds - 600) * 1000);
      var year = searchDate.getFullYear();
      var month = ('0' + (searchDate.getMonth() + 1)).slice(-2);
      var day = ('0' + searchDate.getDate()).slice(-2);
      query += ' after:' + year + '/' + month + '/' + day;
    }
    
    var threads = GmailApp.search(query, 0, 50);
    
    for (var i = 0; i < threads.length; i++) {
      var messages = threads[i].getMessages();
      for (var j = messages.length - 1; j >= 0; j--) {
        var msg = messages[j];
        var msgDate = msg.getDate();
        var msgEpoch = Math.floor(msgDate.getTime() / 1000);
        
        if (sinceSeconds > 0 && msgEpoch < (sinceSeconds - 600)) {
          continue;
        }
        
        var body = msg.getBody() + ' ' + msg.getPlainBody();
        var subject = msg.getSubject() || '';
        
        // 3. Extract signed Bandcamp download link
        var regex = /https?:\\/\\/[a-zA-Z0-9.-]*bandcamp\\.com\\/download\\?[^"\'\\s<>&]+/gi;
        var matches = body.match(regex);
        
        if (matches && matches.length > 0) {
          for (var k = 0; k < matches.length; k++) {
            var rawUrl = matches[k].replace(/&amp;/g, '&');
            
            // Check if matches releaseId or clean numeric ID
            var hasId = cleanReleaseId ? (rawUrl.indexOf('id=' + cleanReleaseId) !== -1 || body.indexOf(cleanReleaseId) !== -1) : true;
            
            // Check if matches title if provided
            var hasTitle = true;
            if (title) {
              var cleanTitle = title.toLowerCase().replace(/[^a-z0-9]/g, '');
              var cleanSubject = subject.toLowerCase().replace(/[^a-z0-9]/g, '');
              var cleanBody = body.toLowerCase().replace(/[^a-z0-9]/g, '');
              hasTitle = cleanSubject.indexOf(cleanTitle) !== -1 || cleanBody.indexOf(cleanTitle) !== -1;
            }
            
            if (hasId && hasTitle) {
              return createJsonResponse({
                found: true,
                downloadPageUrl: rawUrl,
                subject: subject,
                receivedAt: msgEpoch,
                messageId: msg.getId()
              });
            }
          }
        }
      }
    }
    
    return createJsonResponse({
      found: false,
      message: 'No matching Bandcamp email found yet',
      query: query,
      checkedThreads: threads.length
    });
  } catch (err) {
    return createJsonResponse({ 
      found: false, 
      error: err.toString() 
    });
  }
}

function createJsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
`;
