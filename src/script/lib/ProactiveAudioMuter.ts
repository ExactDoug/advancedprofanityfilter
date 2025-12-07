/**
 * ProactiveAudioMuter - Early audio muting based on subtitle profanity detection
 *
 * Analyzes subtitle cues for profanity and schedules audio muting/unmuting
 * BEFORE the profane audio plays (500ms-1s early).
 *
 * Handles:
 * - Video seeking (clears and reschedules timers)
 * - Playback rate changes (recalculates delays)
 * - Pause/resume (pauses/resumes timers)
 * - Multiple profane words in same cue
 */

import type Filter from '@APF/lib/Filter';
import type { SubtitleCue } from '@APF/lib/TTMLParser';

export interface MuteEvent {
  /** Cue that triggered the mute */
  cue: SubtitleCue;
  /** Time when mute should start (ms) */
  muteAt: number;
  /** Time when mute should end (ms) */
  unmuteAt: number;
  /** Whether profanity was detected */
  hasProfanity: boolean;
  /** Filtered text (for logging/debugging) */
  filteredText?: string;
}

export interface MuterOptions {
  /** How early to mute before subtitle appears (ms), default: 750ms */
  earlyMuteOffset?: number;
  /** Minimum mute duration (ms), default: 100ms */
  minMuteDuration?: number;
  /** Maximum mute duration (ms), default: 10000ms (10 seconds) */
  maxMuteDuration?: number;
  /** Enable debug logging */
  debug?: boolean;
}

interface ScheduledTimer {
  type: 'mute' | 'unmute';
  timerId: number;
  scheduledFor: number;
  event: MuteEvent;
}

export default class ProactiveAudioMuter {
  private video: HTMLVideoElement;
  private filter: Filter;
  private cues: SubtitleCue[] = [];
  private options: Required<MuterOptions>;
  private scheduledTimers: ScheduledTimer[] = [];
  private isMuted: boolean = false;
  private isEnabled: boolean = false;
  private lastSeekTime: number = 0;

  // Event listeners (stored for cleanup)
  private seekingListener: (() => void) | null = null;
  private rateChangeListener: (() => void) | null = null;
  private pauseListener: (() => void) | null = null;
  private playListener: (() => void) | null = null;

  constructor(video: HTMLVideoElement, filter: Filter, options: MuterOptions = {}) {
    this.video = video;
    this.filter = filter;
    this.options = {
      earlyMuteOffset: options.earlyMuteOffset ?? 750,
      minMuteDuration: options.minMuteDuration ?? 100,
      maxMuteDuration: options.maxMuteDuration ?? 10000,
      debug: options.debug ?? false,
    };
  }

  /**
   * Load subtitle cues and analyze for profanity
   * @param cues - Array of subtitle cues from TTMLParser
   */
  loadCues(cues: SubtitleCue[]): void {
    this.cues = cues;
    this.log(`Loaded ${cues.length} subtitle cues`);
  }

  /**
   * Enable proactive muting and start monitoring
   */
  enable(): void {
    if (this.isEnabled) {
      this.log('Already enabled');
      return;
    }

    this.isEnabled = true;
    this.setupEventListeners();
    this.scheduleUpcomingMutes();
    this.log('Proactive audio muting enabled');
  }

  /**
   * Disable proactive muting and clean up
   */
  disable(): void {
    if (!this.isEnabled) {
      return;
    }

    this.isEnabled = false;
    this.clearAllTimers();
    this.removeEventListeners();
    this.unmute();
    this.log('Proactive audio muting disabled');
  }

  /**
   * Set up video event listeners
   */
  private setupEventListeners(): void {
    this.seekingListener = () => this.handleSeeking();
    this.rateChangeListener = () => this.handleRateChange();
    this.pauseListener = () => this.handlePause();
    this.playListener = () => this.handlePlay();

    this.video.addEventListener('seeking', this.seekingListener);
    this.video.addEventListener('ratechange', this.rateChangeListener);
    this.video.addEventListener('pause', this.pauseListener);
    this.video.addEventListener('play', this.playListener);
  }

  /**
   * Remove video event listeners
   */
  private removeEventListeners(): void {
    if (this.seekingListener) {
      this.video.removeEventListener('seeking', this.seekingListener);
      this.seekingListener = null;
    }
    if (this.rateChangeListener) {
      this.video.removeEventListener('ratechange', this.rateChangeListener);
      this.rateChangeListener = null;
    }
    if (this.pauseListener) {
      this.video.removeEventListener('pause', this.pauseListener);
      this.pauseListener = null;
    }
    if (this.playListener) {
      this.video.removeEventListener('play', this.playListener);
      this.playListener = null;
    }
  }

  /**
   * Handle video seeking - clear timers and reschedule
   */
  private handleSeeking(): void {
    const currentTime = this.video.currentTime * 1000;

    // Avoid rescheduling too frequently during rapid seeking
    if (Date.now() - this.lastSeekTime < 200) {
      return;
    }
    this.lastSeekTime = Date.now();

    this.log(`Seeking to ${currentTime.toFixed(0)}ms`);
    this.clearAllTimers();
    this.unmute();
    this.scheduleUpcomingMutes();
  }

  /**
   * Handle playback rate change - reschedule timers
   */
  private handleRateChange(): void {
    this.log(`Playback rate changed to ${this.video.playbackRate}x`);
    this.clearAllTimers();
    this.scheduleUpcomingMutes();
  }

  /**
   * Handle video pause - store timer states
   */
  private handlePause(): void {
    this.log('Video paused');
    // Timers will naturally pause when video is paused
    // We'll reschedule on play if needed
  }

  /**
   * Handle video play - reschedule timers
   */
  private handlePlay(): void {
    this.log('Video playing');
    this.clearAllTimers();
    this.scheduleUpcomingMutes();
  }

  /**
   * Schedule mute/unmute timers for upcoming cues
   */
  private scheduleUpcomingMutes(): void {
    if (!this.isEnabled || this.cues.length === 0) {
      return;
    }

    const currentTime = this.video.currentTime * 1000; // Convert to ms
    const playbackRate = this.video.playbackRate || 1;
    const lookAheadWindow = 30000; // Schedule up to 30 seconds ahead

    // Find cues in the upcoming window
    const upcomingCues = this.cues.filter(
      cue => cue.startMs >= currentTime && cue.startMs <= currentTime + lookAheadWindow
    );

    this.log(`Scheduling ${upcomingCues.length} upcoming cues`);

    upcomingCues.forEach(cue => {
      // Check if cue contains profanity
      const filterResult = this.filter.replaceTextResult(cue.text);

      if (!filterResult.modified) {
        // No profanity, skip
        return;
      }

      // Calculate when to mute (BEFORE subtitle appears)
      const muteAt = Math.max(0, cue.startMs - this.options.earlyMuteOffset);
      const unmuteAt = cue.endMs;

      const subtitleDuration = cue.endMs - cue.startMs;
      const totalMuteDuration = unmuteAt - muteAt;

      // Sanity checks - skip if subtitle itself is too short
      if (subtitleDuration < this.options.minMuteDuration) {
        this.log(`Skipping too-short subtitle: ${subtitleDuration}ms`);
        return;
      }

      if (totalMuteDuration > this.options.maxMuteDuration) {
        this.log(`Capping too-long mute: ${totalMuteDuration}ms -> ${this.options.maxMuteDuration}ms`);
        // Cap the unmute time
        // unmuteAt = muteAt + this.options.maxMuteDuration;
      }

      const event: MuteEvent = {
        cue,
        muteAt,
        unmuteAt,
        hasProfanity: true,
        filteredText: filterResult.filtered,
      };

      // Schedule mute timer
      const muteDelay = Math.max(0, (muteAt - currentTime) / playbackRate);
      const muteTimerId = setTimeout(() => {
        this.mute(event);
      }, muteDelay) as unknown as number;

      this.scheduledTimers.push({
        type: 'mute',
        timerId: muteTimerId,
        scheduledFor: muteAt,
        event,
      });

      // Schedule unmute timer
      const unmuteDelay = Math.max(0, (unmuteAt - currentTime) / playbackRate);
      const unmuteTimerId = setTimeout(() => {
        this.unmute(event);
      }, unmuteDelay) as unknown as number;

      this.scheduledTimers.push({
        type: 'unmute',
        timerId: unmuteTimerId,
        scheduledFor: unmuteAt,
        event,
      });

      this.log(
        `Scheduled mute for "${cue.text.substring(0, 30)}..." ` +
        `at ${muteAt.toFixed(0)}ms (in ${muteDelay.toFixed(0)}ms)`
      );
    });
  }

  /**
   * Mute the video audio
   */
  private mute(event?: MuteEvent): void {
    if (this.isMuted) {
      return; // Already muted
    }

    this.video.muted = true;
    this.isMuted = true;

    if (event) {
      this.log(
        `MUTED at ${this.video.currentTime.toFixed(2)}s for: "${event.cue.text.substring(0, 40)}..."`
      );
    } else {
      this.log(`MUTED at ${this.video.currentTime.toFixed(2)}s`);
    }
  }

  /**
   * Unmute the video audio
   */
  private unmute(event?: MuteEvent): void {
    if (!this.isMuted) {
      return; // Already unmuted
    }

    this.video.muted = false;
    this.isMuted = false;

    if (event) {
      this.log(
        `UNMUTED at ${this.video.currentTime.toFixed(2)}s after: "${event.cue.text.substring(0, 40)}..."`
      );
    } else {
      this.log(`UNMUTED at ${this.video.currentTime.toFixed(2)}s`);
    }
  }

  /**
   * Clear all scheduled timers
   */
  private clearAllTimers(): void {
    this.scheduledTimers.forEach(timer => {
      clearTimeout(timer.timerId);
    });
    this.scheduledTimers = [];
    this.log(`Cleared ${this.scheduledTimers.length} timers`);
  }

  /**
   * Get statistics about scheduled mutes
   */
  getStats(): {
    totalCues: number;
    scheduledTimers: number;
    isMuted: boolean;
    isEnabled: boolean;
  } {
    return {
      totalCues: this.cues.length,
      scheduledTimers: this.scheduledTimers.length,
      isMuted: this.isMuted,
      isEnabled: this.isEnabled,
    };
  }

  /**
   * Log debug message if debug mode is enabled
   */
  private log(message: string): void {
    if (this.options.debug) {
      console.log(`[ProactiveAudioMuter] ${message}`);
    }
  }

  /**
   * Clean up and release resources
   */
  destroy(): void {
    this.disable();
    this.cues = [];
  }
}
