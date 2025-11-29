// Quick test script to verify Netflix subtitle API interception
// This should be injected EARLY (at document_start) to catch the API calls

(function() {
  console.log('[APF Test] Installing Netflix subtitle interceptor...');

  // Must inject into page context (not content script context)
  const script = document.createElement('script');
  script.textContent = `
    (function() {
      console.log('[APF Test] Hook injected into page context');

      const originalParse = JSON.parse;
      let callCount = 0;

      JSON.parse = function(text) {
        const data = originalParse(text);
        callCount++;

        // Check if this looks like subtitle data
        if (data && data.result && data.result.timedtexttracks) {
          console.log('🎉🎉🎉 [APF Test] FOUND SUBTITLE DATA! 🎉🎉🎉');
          console.log('[APF Test] Call number:', callCount);
          console.log('[APF Test] Movie ID:', data.result.movieId);
          console.log('[APF Test] Number of tracks:', data.result.timedtexttracks.length);

          // Show first track details
          if (data.result.timedtexttracks.length > 0) {
            const track = data.result.timedtexttracks[0];
            console.log('[APF Test] First track language:', track.language);
            console.log('[APF Test] First track type:', track.rawTrackType);

            if (track.ttDownloadables && track.ttDownloadables['webvtt-lssdh-ios8']) {
              const webvtt = track.ttDownloadables['webvtt-lssdh-ios8'];
              const urls = webvtt.downloadUrls || webvtt.urls;
              console.log('[APF Test] WebVTT URLs:', urls);

              if (urls && Object.keys(urls).length > 0) {
                const firstUrl = Object.values(urls)[0];
                console.log('[APF Test] First URL:', firstUrl);
                console.log('[APF Test] ✅ SUCCESS! We can intercept subtitle URLs!');
              }
            }
          }

          // Store globally for inspection
          window.APF_SUBTITLE_DATA = data.result;
          console.log('[APF Test] Data saved to window.APF_SUBTITLE_DATA');
        }

        return data;
      };

      console.log('[APF Test] JSON.parse hook installed in page context');
    })();
  `;

  // Inject before any other scripts run
  (document.head || document.documentElement).appendChild(script);
  script.remove(); // Clean up the script element

  console.log('[APF Test] Hook injection complete');
})();
