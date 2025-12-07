/**
 * SubtitleFetcher for Netflix and other streaming services
 *
 * Intercepts subtitle API responses, fetches subtitle files, and parses them
 * for proactive audio muting based on profanity detection.
 *
 * Implements fallback chain:
 * 1. DFXP (dfxp-ls-sdh) - Netflix primary format (95%+ availability)
 * 2. IMSC 1.1 (imsc1.1) - Secondary format for Japanese and future expansion
 * 3. WebVTT (webvtt-lssdh-ios8) - Optional fallback (deprecated on Netflix)
 */

import TTMLParser, { SubtitleCue } from '@APF/lib/TTMLParser';

export interface SubtitleTrack {
  language: string;
  isNoneTrack?: boolean;
  isForcedNarrative?: boolean;
  rawTrackType?: string;
  ttDownloadables?: {
    [format: string]: {
      urls?: { [key: string]: string } | string[];
      downloadUrls?: { [key: string]: string } | string[];
    };
  };
}

export interface SubtitleData {
  movieId: string | number;
  timedtexttracks: SubtitleTrack[];
}

export interface FetchResult {
  success: boolean;
  cues: SubtitleCue[];
  format?: string;
  language?: string;
  error?: string;
  warnings?: string[];
}

export default class SubtitleFetcher {
  // Cache of parsed subtitles by movieId
  private static cache: Map<string, FetchResult> = new Map();

  // Format priority for fallback chain
  private static readonly FORMAT_PRIORITY = [
    'dfxp-ls-sdh',      // DFXP - Netflix primary (95%+ availability)
    'imsc1.1',          // IMSC 1.1 - Secondary for Japanese
    'webvtt-lssdh-ios8' // WebVTT - Optional fallback
  ];

  /**
   * Fetch and parse subtitles for a given movie/episode
   * @param subtitleData - Netflix subtitle API response data
   * @param preferredLanguage - Preferred subtitle language (default: 'en')
   * @param forceRefetch - Force refetch even if cached
   * @returns FetchResult with parsed cues
   */
  static async fetch(
    subtitleData: SubtitleData,
    preferredLanguage: string = 'en',
    forceRefetch: boolean = false
  ): Promise<FetchResult> {
    const movieId = String(subtitleData.movieId);
    const cacheKey = `${movieId}-${preferredLanguage}`;

    // Check cache first
    if (!forceRefetch && this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey)!;
      return { ...cached }; // Return a copy to prevent mutations
    }

    try {
      // Find preferred language track
      const track = this.findPreferredTrack(subtitleData.timedtexttracks, preferredLanguage);

      if (!track) {
        const result: FetchResult = {
          success: false,
          cues: [],
          error: `No suitable subtitle track found for language: ${preferredLanguage}`,
        };
        this.cache.set(cacheKey, result);
        return result;
      }

      // Try each format in priority order
      for (const format of this.FORMAT_PRIORITY) {
        const url = this.extractURL(track, format);

        if (!url) {
          continue; // Try next format
        }

        try {
          // Fetch subtitle file
          const response = await fetch(url);

          if (!response.ok) {
            continue; // Try next format
          }

          const content = await response.text();

          // Parse based on format
          let parseResult;
          if (format.includes('webvtt')) {
            // WebVTT format - TODO: implement WebVTT parser if needed
            // For now, skip WebVTT and only use TTML formats
            continue;
          } else {
            // TTML/DFXP/IMSC format
            parseResult = TTMLParser.parse(content);
          }

          if (parseResult.success && parseResult.cues.length > 0) {
            const result: FetchResult = {
              success: true,
              cues: parseResult.cues,
              format: parseResult.format,
              language: track.language,
              warnings: parseResult.warnings,
            };

            // Cache the result
            this.cache.set(cacheKey, result);

            return result;
          }
        } catch (error) {
          // Continue to next format on error
          continue;
        }
      }

      // No formats succeeded
      const result: FetchResult = {
        success: false,
        cues: [],
        error: 'Failed to fetch or parse subtitles from any available format',
      };
      this.cache.set(cacheKey, result);
      return result;
    } catch (error) {
      const result: FetchResult = {
        success: false,
        cues: [],
        error: `Unexpected error: ${error.message}`,
      };
      return result;
    }
  }

  /**
   * Find the preferred subtitle track
   * @param tracks - Array of subtitle tracks
   * @param language - Preferred language code
   * @returns Best matching track or null
   */
  private static findPreferredTrack(
    tracks: SubtitleTrack[],
    language: string
  ): SubtitleTrack | null {
    // Filter out "None" tracks
    const validTracks = tracks.filter(t => !t.isNoneTrack);

    // First try: exact language match, not forced, closedcaptions
    let track = validTracks.find(
      t =>
        t.language === language &&
        !t.isForcedNarrative &&
        t.rawTrackType === 'closedcaptions'
    );

    if (track) return track;

    // Second try: exact language match, not forced, subtitles
    track = validTracks.find(
      t =>
        t.language === language &&
        !t.isForcedNarrative &&
        t.rawTrackType === 'subtitles'
    );

    if (track) return track;

    // Third try: exact language match, not forced, any type
    track = validTracks.find(
      t => t.language === language && !t.isForcedNarrative
    );

    if (track) return track;

    // Fourth try: exact language match (including forced)
    track = validTracks.find(t => t.language === language);

    return track || null;
  }

  /**
   * Extract URL from a subtitle track for a specific format
   * @param track - Subtitle track
   * @param format - Format identifier
   * @returns URL string or null
   */
  private static extractURL(track: SubtitleTrack, format: string): string | null {
    if (!track.ttDownloadables || !track.ttDownloadables[format]) {
      return null;
    }

    const downloadable = track.ttDownloadables[format];
    const urls = downloadable.urls || downloadable.downloadUrls;

    if (!urls) {
      return null;
    }

    // Handle different URL structures
    if (Array.isArray(urls)) {
      // Array of URL objects: [{cdn_id: 1, url: "..."}]
      if (urls.length > 0) {
        const firstItem = urls[0];
        if (typeof firstItem === 'string') {
          return firstItem;
        } else if (firstItem && typeof firstItem === 'object' && 'url' in firstItem) {
          return (firstItem as any).url;
        }
      }
    } else if (typeof urls === 'object') {
      // Object with URL values: {cdn_id: "url"}
      const urlValues = Object.values(urls);
      if (urlValues.length > 0) {
        const firstUrl = urlValues[0];
        if (typeof firstUrl === 'string') {
          return firstUrl;
        } else if (firstUrl && typeof firstUrl === 'object' && 'url' in firstUrl) {
          return (firstUrl as any).url;
        }
      }
    } else if (typeof urls === 'string') {
      // Direct string URL
      return urls;
    }

    return null;
  }

  /**
   * Clear cached subtitles (useful when switching videos)
   * @param movieId - Optional specific movie ID to clear, or clear all if not provided
   */
  static clearCache(movieId?: string): void {
    if (movieId) {
      // Clear all entries for this movie ID (all languages)
      const keysToDelete = Array.from(this.cache.keys()).filter(key =>
        key.startsWith(`${movieId}-`)
      );
      keysToDelete.forEach(key => this.cache.delete(key));
    } else {
      // Clear entire cache
      this.cache.clear();
    }
  }

  /**
   * Get cached subtitle data if available
   * @param movieId - Movie/episode ID
   * @param language - Language code
   * @returns FetchResult or null if not cached
   */
  static getCached(movieId: string | number, language: string = 'en'): FetchResult | null {
    const cacheKey = `${movieId}-${language}`;
    const cached = this.cache.get(cacheKey);
    return cached ? { ...cached } : null;
  }

  /**
   * Check if subtitles are cached for a movie
   * @param movieId - Movie/episode ID
   * @param language - Language code
   * @returns true if cached
   */
  static isCached(movieId: string | number, language: string = 'en'): boolean {
    const cacheKey = `${movieId}-${language}`;
    return this.cache.has(cacheKey);
  }

  /**
   * Install JSON.parse hook to intercept Netflix subtitle API
   * This should be called EARLY (at document_start) to catch the API response
   * @param onSubtitleData - Callback when subtitle data is intercepted
   */
  static installNetflixHook(onSubtitleData: (data: SubtitleData) => void): void {
    // This must be injected into page context, not content script context
    const script = document.createElement('script');
    script.textContent = `
      (function() {
        const originalParse = JSON.parse;
        let subtitleDataFound = false;

        JSON.parse = function(text) {
          const data = originalParse(text);

          // Check if this is Netflix subtitle API response
          if (!subtitleDataFound && data && data.result && data.result.timedtexttracks && data.result.movieId) {
            subtitleDataFound = true;

            // Store globally so content script can access it
            window.APF_SUBTITLE_DATA = data.result;

            // Dispatch custom event to notify content script
            window.dispatchEvent(new CustomEvent('apf-subtitle-data', {
              detail: data.result
            }));
          }

          return data;
        };
      })();
    `;

    // Inject before any other scripts run
    (document.head || document.documentElement).appendChild(script);
    script.remove();

    // Listen for the custom event in content script context
    window.addEventListener('apf-subtitle-data', (event: CustomEvent) => {
      onSubtitleData(event.detail);
    });
  }

  /**
   * Get cache statistics
   * @returns Object with cache stats
   */
  static getCacheStats(): { size: number; keys: string[] } {
    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys()),
    };
  }
}
