// ==UserScript==
// @name         Netflix Subtitle API Interceptor - Test
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Intercepts Netflix subtitle API calls to test early muting feasibility
// @author       APF Development
// @match        https://www.netflix.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=netflix.com
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function() {
    'use strict';

    console.log('🎬 [APF Interceptor] Script loaded at document-start');

    // Hook JSON.parse BEFORE Netflix's code runs
    const originalParse = JSON.parse;
    let callCount = 0;
    let foundSubtitleData = false;

    JSON.parse = function(text) {
        const data = originalParse(text);
        callCount++;

        // Check if this is Netflix's subtitle data response
        if (data && data.result && data.result.timedtexttracks && data.result.movieId) {
            if (!foundSubtitleData) {
                foundSubtitleData = true;
                console.log('');
                console.log('═══════════════════════════════════════════════════════');
                console.log('🎉🎉🎉 NETFLIX SUBTITLE DATA INTERCEPTED! 🎉🎉🎉');
                console.log('═══════════════════════════════════════════════════════');
                console.log('');
            }

            console.log('📺 Movie/Episode ID:', data.result.movieId);
            console.log('📝 Total subtitle tracks:', data.result.timedtexttracks.length);
            console.log('');

            // Process each subtitle track
            data.result.timedtexttracks.forEach((track, i) => {
                if (track.isNoneTrack) {
                    console.log(`Track ${i}: [None/Off track - skip]`);
                    return;
                }

                const trackType = track.rawTrackType || 'unknown';
                const lang = track.language || 'unknown';
                const forced = track.isForcedNarrative ? ' [FORCED]' : '';
                const variant = track.trackVariant ? ` (variant: ${track.trackVariant})` : '';

                console.log(`Track ${i}: ${lang}${forced}${variant} [${trackType}]`);

                // Check for available subtitle formats
                if (track.ttDownloadables) {
                    const formats = Object.keys(track.ttDownloadables);
                    console.log(`  Available formats: ${formats.join(', ')}`);

                    // Try to get WebVTT URLs (preferred format)
                    if (track.ttDownloadables['webvtt-lssdh-ios8']) {
                        const webvtt = track.ttDownloadables['webvtt-lssdh-ios8'];
                        const urls = webvtt.downloadUrls || webvtt.urls;

                        if (urls) {
                            // Get the first URL
                            const urlList = typeof urls === 'object' ? Object.values(urls) : [urls];
                            if (urlList.length > 0) {
                                console.log(`  📥 WebVTT URL:`, urlList[0]);

                                // Offer to download it
                                if (i === 0) { // Only for first English track
                                    console.log(`  💡 TIP: Right-click URL above → "Open in new tab" to download VTT file`);
                                }
                            }
                        }
                    }

                    // Also check for DFXP format
                    if (track.ttDownloadables['dfxp-ls-sdh']) {
                        const dfxp = track.ttDownloadables['dfxp-ls-sdh'];
                        const urls = dfxp.downloadUrls || dfxp.urls;
                        if (urls) {
                            const urlList = typeof urls === 'object' ? Object.values(urls) : [urls];
                            if (urlList.length > 0) {
                                console.log(`  📥 DFXP URL:`, urlList[0]);
                            }
                        }
                    }
                }
                console.log('');
            });

            // Store data globally for manual inspection
            window.NETFLIX_SUBTITLE_DATA = data.result;
            window.APF_SUBTITLE_DATA = data.result; // Also store with APF prefix

            console.log('✅ Full data saved to:');
            console.log('   • window.NETFLIX_SUBTITLE_DATA');
            console.log('   • window.APF_SUBTITLE_DATA');
            console.log('');
            console.log('💡 Next steps:');
            console.log('   1. Copy a WebVTT URL from above');
            console.log('   2. Open it in a new tab to see the subtitle file');
            console.log('   3. Note the timing format: HH:MM:SS.mmm --> HH:MM:SS.mmm');
            console.log('   4. This proves we can pre-load subtitles for early muting!');
            console.log('');
            console.log('═══════════════════════════════════════════════════════');
            console.log('');

            // Optional: Auto-fetch first English VTT file for preview
            const firstEnglishTrack = data.result.timedtexttracks.find(
                t => t.language === 'en' && !t.isNoneTrack && t.ttDownloadables?.['webvtt-lssdh-ios8']
            );

            if (firstEnglishTrack) {
                const webvtt = firstEnglishTrack.ttDownloadables['webvtt-lssdh-ios8'];
                const urls = webvtt.downloadUrls || webvtt.urls;
                if (urls) {
                    const urlList = typeof urls === 'object' ? Object.values(urls) : [urls];
                    if (urlList.length > 0) {
                        const vttUrl = urlList[0];
                        console.log('🔍 Auto-fetching English VTT file for preview...');

                        fetch(vttUrl)
                            .then(response => response.text())
                            .then(vttContent => {
                                console.log('📄 VTT File Preview (first 1000 characters):');
                                console.log('─────────────────────────────────────────────');
                                console.log(vttContent.substring(0, 1000));
                                console.log('─────────────────────────────────────────────');
                                console.log(`📊 Full VTT file size: ${vttContent.length} characters`);
                                console.log('💾 Stored in: window.NETFLIX_VTT_FILE');
                                window.NETFLIX_VTT_FILE = vttContent;

                                // Count cues
                                const cueMatches = vttContent.match(/\d{2}:\d{2}:\d{2}\.\d{3} --> \d{2}:\d{2}:\d{2}\.\d{3}/g);
                                if (cueMatches) {
                                    console.log(`📝 Total subtitle cues: ${cueMatches.length}`);
                                }
                            })
                            .catch(err => {
                                console.warn('⚠️ Could not auto-fetch VTT file:', err.message);
                            });
                    }
                }
            }
        }

        return data;
    };

    console.log('✅ [APF Interceptor] JSON.parse hook installed');
    console.log('⏳ Waiting for Netflix to load subtitle data...');
    console.log('📍 If you see subtitle data above, the hook worked!');
    console.log('');

    // Also log when we're on a watch page
    if (window.location.pathname.includes('/watch/')) {
        console.log('🎬 On Netflix watch page - subtitle data should load soon...');
    }
})();
