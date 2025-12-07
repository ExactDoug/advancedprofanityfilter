/**
 * WebAudio - Netflix subtitle-based proactive audio muting
 *
 * Orchestrates subtitle fetching, parsing, and proactive audio muting
 * to mute profanity BEFORE it's spoken (500ms-1s early).
 */

import type Filter from '@APF/lib/Filter';
import SubtitleFetcher, { SubtitleData } from '@APF/lib/SubtitleFetcher';
import ProactiveAudioMuter from '@APF/lib/ProactiveAudioMuter';
import type Config from '@APF/lib/Config';

export default class WebAudio {
  private filter: Filter;
  private config: Config;
  private muter: ProactiveAudioMuter | null = null;
  private enabled: boolean = false;
  private currentMovieId: string | null = null;
  private videoElement: HTMLVideoElement | null = null;

  constructor(filter: Filter) {
    this.filter = filter;
    this.config = filter.cfg;
  }

  /**
   * Initialize WebAudio for supported sites (Netflix)
   */
  init(): void {
    // Only enable on supported sites
    if (!this.isSupportedSite()) {
      return;
    }

    // Check if feature is enabled in config
    if (!this.isFeatureEnabled()) {
      return;
    }

    this.enabled = true;
    this.setupNetflixIntegration();
  }

  /**
   * Check if current site is supported for audio muting
   */
  private isSupportedSite(): boolean {
    return window.location.hostname.includes('netflix.com');
  }

  /**
   * Check if audio muting feature is enabled in user config
   */
  private isFeatureEnabled(): boolean {
    // TODO: Add proper config option once UI is implemented
    // For now, return true to enable by default
    return true;
  }

  /**
   * Set up Netflix subtitle interception and video monitoring
   */
  private setupNetflixIntegration(): void {
    // Install subtitle API hook
    SubtitleFetcher.installNetflixHook((subtitleData: SubtitleData) => {
      this.handleSubtitleData(subtitleData);
    });

    // Monitor for video element
    this.monitorForVideo();
  }

  /**
   * Monitor page for video element and set up muting when found
   */
  private monitorForVideo(): void {
    const observer = new MutationObserver(() => {
      if (!this.videoElement) {
        const video = document.querySelector('video');
        if (video) {
          this.videoElement = video;
          this.setupVideoMonitoring(video);
        }
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    // Also check immediately
    const video = document.querySelector('video');
    if (video) {
      this.videoElement = video;
      this.setupVideoMonitoring(video);
    }
  }

  /**
   * Set up monitoring for video events
   */
  private setupVideoMonitoring(video: HTMLVideoElement): void {
    // Listen for video source changes (new movie/episode)
    video.addEventListener('loadedmetadata', () => {
      // Clear cache when switching to a different video
      if (this.currentMovieId) {
        SubtitleFetcher.clearCache(this.currentMovieId);
      }
      this.currentMovieId = null;

      // Disable old muter if exists
      if (this.muter) {
        this.muter.destroy();
        this.muter = null;
      }
    });
  }

  /**
   * Handle intercepted subtitle data from Netflix API
   */
  private async handleSubtitleData(subtitleData: SubtitleData): Promise<void> {
    if (!this.enabled || !this.videoElement) {
      return;
    }

    const movieId = String(subtitleData.movieId);

    // Skip if we already processed this movie
    if (this.currentMovieId === movieId && this.muter) {
      return;
    }

    this.currentMovieId = movieId;

    try {
      // Fetch and parse subtitles
      const result = await SubtitleFetcher.fetch(subtitleData, this.getPreferredLanguage());

      if (!result.success || result.cues.length === 0) {
        console.warn('[APF WebAudio] Failed to fetch subtitles:', result.error);
        return;
      }

      console.log(`[APF WebAudio] Loaded ${result.cues.length} subtitle cues (${result.format})`);

      // Create and configure muter
      this.muter = new ProactiveAudioMuter(this.videoElement, this.filter, {
        earlyMuteOffset: this.getEarlyMuteOffset(),
        minMuteDuration: 100,
        maxMuteDuration: 10000,
        debug: this.isDebugEnabled()
      });

      // Load cues and enable muting
      this.muter.loadCues(result.cues);
      this.muter.enable();

      console.log('[APF WebAudio] Proactive audio muting enabled');
    } catch (error) {
      console.error('[APF WebAudio] Error setting up audio muting:', error);
    }
  }

  /**
   * Get preferred subtitle language from config or browser
   */
  private getPreferredLanguage(): string {
    // TODO: Get from user config once UI is implemented
    // For now, use browser language or default to 'en'
    const browserLang = navigator.language.split('-')[0];
    return browserLang || 'en';
  }

  /**
   * Get early mute offset from config
   */
  private getEarlyMuteOffset(): number {
    // TODO: Get from user config once UI is implemented
    // For now, default to 750ms (0.75 seconds early)
    return 750;
  }

  /**
   * Check if debug mode is enabled
   */
  private isDebugEnabled(): boolean {
    // TODO: Get from user config once UI is implemented
    return false;
  }

  /**
   * Disable audio muting
   */
  disable(): void {
    this.enabled = false;
    if (this.muter) {
      this.muter.destroy();
      this.muter = null;
    }
  }

  /**
   * Get statistics about current state
   */
  getStats(): {
    enabled: boolean;
    supported: boolean;
    movieId: string | null;
    muterStats: any;
  } {
    return {
      enabled: this.enabled,
      supported: this.isSupportedSite(),
      movieId: this.currentMovieId,
      muterStats: this.muter?.getStats() || null
    };
  }
}
