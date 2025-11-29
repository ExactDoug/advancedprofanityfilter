import WebFilter from '@APF/WebFilter';

const filter = new WebFilter();

// TEMPORARY TEST: Netflix subtitle interception
if (window.location.hostname.includes('netflix.com')) {
  const script = document.createElement('script');
  script.textContent = `
    (function() {
      console.log('[APF Test] Installing Netflix subtitle interceptor...');
      const originalParse = JSON.parse;
      let callCount = 0;

      JSON.parse = function(text) {
        const data = originalParse(text);
        callCount++;

        if (data && data.result && data.result.timedtexttracks) {
          console.log('🎉 [APF] FOUND SUBTITLE DATA!');
          console.log('[APF] Movie ID:', data.result.movieId);
          console.log('[APF] Tracks:', data.result.timedtexttracks.length);

          data.result.timedtexttracks.forEach((track, i) => {
            if (track.ttDownloadables && track.ttDownloadables['webvtt-lssdh-ios8']) {
              const urls = track.ttDownloadables['webvtt-lssdh-ios8'].downloadUrls ||
                          track.ttDownloadables['webvtt-lssdh-ios8'].urls;
              console.log('[APF] Track ' + i + ' (' + track.language + ') VTT URLs:', urls);
            }
          });

          window.APF_SUBTITLE_DATA = data.result;
        }
        return data;
      };
    })();
  `;
  (document.head || document.documentElement).appendChild(script);
  script.remove();
  console.log('[APF] Netflix interception hook installed');
}

if (
  typeof window !== 'undefined' &&
  ['[object Window]', '[object ContentScriptGlobalScope]'].includes({}.toString.call(window))
) {
  filter.initPageDetails();
  filter.cleanPage();
}
