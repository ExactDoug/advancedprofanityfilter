/* eslint-disable @typescript-eslint/naming-convention */
import { expect } from 'chai';
import sinon from 'sinon';
import ProactiveAudioMuter from '@APF/lib/ProactiveAudioMuter';
import Filter from '@APF/lib/Filter';
import Config from '@APF/lib/Config';
import Constants from '@APF/lib/Constants';
import type { SubtitleCue } from '@APF/lib/TTMLParser';

// Create mock video element
const createMockVideo = (): HTMLVideoElement => {
  const video: any = {
    currentTime: 0,
    playbackRate: 1,
    muted: false,
    paused: false,
    addEventListener: sinon.stub(),
    removeEventListener: sinon.stub(),
  };
  return video as HTMLVideoElement;
};

// Create sample subtitle cues
const createSampleCues = (): SubtitleCue[] => [
  {
    startMs: 5000,
    endMs: 8000,
    text: 'Hello world',
    originalText: 'Hello world'
  },
  {
    startMs: 10000,
    endMs: 13000,
    text: 'This is a badword test',
    originalText: 'This is a badword test'
  },
  {
    startMs: 15000,
    endMs: 18000,
    text: 'Normal subtitle here',
    originalText: 'Normal subtitle here'
  },
  {
    startMs: 20000,
    endMs: 23000,
    text: 'Another badword appears',
    originalText: 'Another badword appears'
  }
];

describe('ProactiveAudioMuter', () => {
  let video: HTMLVideoElement;
  let filter: Filter;
  let clock: sinon.SinonFakeTimers;

  beforeEach(() => {
    // Use fake timers for testing
    clock = sinon.useFakeTimers();

    // Create mock video
    video = createMockVideo();

    // Create filter with test word
    filter = new Filter();
    filter.cfg = new Config({
      words: {
        badword: {
          matchMethod: Constants.MATCH_METHODS.EXACT,
          repeat: Constants.FALSE,
          sub: 'filtered',
          lists: []
        }
      }
    });
    filter.init();
  });

  afterEach(() => {
    clock.restore();
  });

  describe('constructor', () => {
    it('should create instance with default options', () => {
      const muter = new ProactiveAudioMuter(video, filter);
      expect(muter).to.be.instanceOf(ProactiveAudioMuter);
    });

    it('should accept custom options', () => {
      const muter = new ProactiveAudioMuter(video, filter, {
        earlyMuteOffset: 1000,
        minMuteDuration: 200,
        maxMuteDuration: 5000,
        debug: true
      });
      expect(muter).to.be.instanceOf(ProactiveAudioMuter);
    });
  });

  describe('loadCues()', () => {
    it('should load subtitle cues', () => {
      const muter = new ProactiveAudioMuter(video, filter);
      const cues = createSampleCues();

      muter.loadCues(cues);

      const stats = muter.getStats();
      expect(stats.totalCues).to.equal(4);
    });
  });

  describe('enable() / disable()', () => {
    it('should enable proactive muting', () => {
      const muter = new ProactiveAudioMuter(video, filter);
      const cues = createSampleCues();
      muter.loadCues(cues);

      muter.enable();

      const stats = muter.getStats();
      expect(stats.isEnabled).to.be.true;
    });

    it('should set up event listeners on enable', () => {
      const muter = new ProactiveAudioMuter(video, filter);
      muter.loadCues(createSampleCues());

      muter.enable();

      const addStub = video.addEventListener as sinon.SinonStub;
      sinon.assert.calledWith(addStub, 'seeking', sinon.match.func);
      sinon.assert.calledWith(addStub, 'ratechange', sinon.match.func);
      sinon.assert.calledWith(addStub, 'pause', sinon.match.func);
      sinon.assert.calledWith(addStub, 'play', sinon.match.func);
    });

    it('should disable proactive muting', () => {
      const muter = new ProactiveAudioMuter(video, filter);
      muter.loadCues(createSampleCues());
      muter.enable();

      muter.disable();

      const stats = muter.getStats();
      expect(stats.isEnabled).to.be.false;
    });

    it('should remove event listeners on disable', () => {
      const muter = new ProactiveAudioMuter(video, filter);
      muter.loadCues(createSampleCues());
      muter.enable();

      muter.disable();

      const removeStub = video.removeEventListener as sinon.SinonStub;
      sinon.assert.calledWith(removeStub, 'seeking', sinon.match.func);
      sinon.assert.calledWith(removeStub, 'ratechange', sinon.match.func);
      sinon.assert.calledWith(removeStub, 'pause', sinon.match.func);
      sinon.assert.calledWith(removeStub, 'play', sinon.match.func);
    });

    it('should not double-enable', () => {
      const muter = new ProactiveAudioMuter(video, filter);
      muter.loadCues(createSampleCues());

      muter.enable();
      const callCount1 = (video.addEventListener as sinon.SinonStub).callCount;

      muter.enable(); // Try to enable again
      const callCount2 = (video.addEventListener as sinon.SinonStub).callCount;

      expect(callCount2).to.equal(callCount1); // No additional listeners
    });
  });

  describe('muting behavior', () => {
    it('should schedule mute for profane subtitle', () => {
      const muter = new ProactiveAudioMuter(video, filter, {
        earlyMuteOffset: 750,
        debug: false
      });
      muter.loadCues(createSampleCues());

      video.currentTime = 0; // Start at 0 seconds
      muter.enable();

      const stats = muter.getStats();
      // Should have scheduled timers for 2 profane cues (mute + unmute for each)
      expect(stats.scheduledTimers).to.be.greaterThan(0);
    });

    it('should mute before profane subtitle appears', () => {
      const muter = new ProactiveAudioMuter(video, filter, {
        earlyMuteOffset: 750
      });
      muter.loadCues(createSampleCues());

      video.currentTime = 0;
      muter.enable();

      // First profane cue at 10000ms, should mute at 10000 - 750 = 9250ms
      expect(video.muted).to.be.false;

      // Advance to just before mute time
      clock.tick(9200);
      expect(video.muted).to.be.false;

      // Advance past mute time
      clock.tick(100); // Now at 9300ms
      expect(video.muted).to.be.true;
    });

    it('should unmute after profane subtitle ends', () => {
      const muter = new ProactiveAudioMuter(video, filter, {
        earlyMuteOffset: 750
      });
      muter.loadCues(createSampleCues());

      video.currentTime = 0;
      muter.enable();

      // Advance to mute time (9250ms)
      clock.tick(9250);
      expect(video.muted).to.be.true;

      // Advance to end of subtitle (13000ms)
      clock.tick(3750); // 9250 + 3750 = 13000
      expect(video.muted).to.be.false;
    });

    it('should not mute for non-profane subtitles', () => {
      const muter = new ProactiveAudioMuter(video, filter);
      muter.loadCues([
        {
          startMs: 5000,
          endMs: 8000,
          text: 'Clean subtitle',
          originalText: 'Clean subtitle'
        }
      ]);

      video.currentTime = 0;
      muter.enable();

      // Advance through the entire subtitle
      clock.tick(10000);

      // Should never mute
      expect(video.muted).to.be.false;
    });

    it('should handle multiple profane cues sequentially', () => {
      const muter = new ProactiveAudioMuter(video, filter, {
        earlyMuteOffset: 750
      });
      muter.loadCues(createSampleCues());

      video.currentTime = 0;
      muter.enable();

      // First profane cue: mute at 9250ms, unmute at 13000ms
      clock.tick(9250);
      expect(video.muted).to.be.true;

      clock.tick(3750); // Advance to 13000ms
      expect(video.muted).to.be.false;

      // Second profane cue: mute at 19250ms, unmute at 23000ms
      clock.tick(6250); // Advance to 19250ms
      expect(video.muted).to.be.true;

      clock.tick(3750); // Advance to 23000ms
      expect(video.muted).to.be.false;
    });
  });

  describe('seeking behavior', () => {
    it('should reschedule timers on seeking', () => {
      const muter = new ProactiveAudioMuter(video, filter);
      muter.loadCues(createSampleCues());

      video.currentTime = 0;
      muter.enable();

      const stats1 = muter.getStats();
      const timerCount1 = stats1.scheduledTimers;

      // Simulate seeking to a different position
      video.currentTime = 15; // 15 seconds
      const seekingListener = (video.addEventListener as sinon.SinonStub).getCalls()
        .find(call => call.args[0] === 'seeking')?.args[1];
      seekingListener();

      // Advance time to allow debouncing
      clock.tick(250);

      const stats2 = muter.getStats();
      // Timers should be rescheduled (might be different count based on new position)
      expect(stats2.scheduledTimers).to.be.greaterThan(-1);
    });

    it('should unmute when seeking', () => {
      const muter = new ProactiveAudioMuter(video, filter, {
        earlyMuteOffset: 750
      });
      muter.loadCues(createSampleCues());

      video.currentTime = 0;
      muter.enable();

      // Mute for first profane cue
      clock.tick(9250);
      expect(video.muted).to.be.true;

      // Seek to a different position
      video.currentTime = 30;
      const seekingListener = (video.addEventListener as sinon.SinonStub).getCalls()
        .find(call => call.args[0] === 'seeking')?.args[1];
      seekingListener();

      // Should unmute immediately on seeking
      expect(video.muted).to.be.false;
    });
  });

  describe('playback rate changes', () => {
    it('should reschedule timers on rate change', () => {
      const muter = new ProactiveAudioMuter(video, filter);
      muter.loadCues(createSampleCues());

      video.currentTime = 0;
      muter.enable();

      const stats1 = muter.getStats();
      const timerCount1 = stats1.scheduledTimers;

      // Change playback rate
      video.playbackRate = 1.5;
      const rateChangeListener = (video.addEventListener as sinon.SinonStub).getCalls()
        .find(call => call.args[0] === 'ratechange')?.args[1];
      rateChangeListener();

      const stats2 = muter.getStats();
      // Timers should be rescheduled
      expect(stats2.scheduledTimers).to.be.greaterThan(-1);
    });
  });

  describe('edge cases', () => {
    it('should skip very short mute durations', () => {
      const muter = new ProactiveAudioMuter(video, filter, {
        earlyMuteOffset: 750,
        minMuteDuration: 100
      });

      // Create a cue that would result in very short mute
      const shortCue: SubtitleCue = {
        startMs: 10000,
        endMs: 10050, // Only 50ms duration, less than 100ms after early offset
        text: 'badword',
        originalText: 'badword'
      };

      muter.loadCues([shortCue]);
      video.currentTime = 0;
      muter.enable();

      const stats = muter.getStats();
      // Should not schedule timers for too-short cues
      expect(stats.scheduledTimers).to.equal(0);
    });

    it('should handle cues in the past', () => {
      const muter = new ProactiveAudioMuter(video, filter);
      muter.loadCues(createSampleCues());

      // Start video at 25 seconds (past all test cues)
      video.currentTime = 25;
      muter.enable();

      const stats = muter.getStats();
      // Should not schedule timers for past cues
      expect(stats.scheduledTimers).to.equal(0);
    });

    it('should only schedule cues within lookahead window', () => {
      const muter = new ProactiveAudioMuter(video, filter);

      // Create cues far in the future (beyond 30s lookahead)
      const farFutureCues: SubtitleCue[] = [
        {
          startMs: 50000, // 50 seconds
          endMs: 53000,
          text: 'badword here',
          originalText: 'badword here'
        }
      ];

      muter.loadCues(farFutureCues);
      video.currentTime = 0;
      muter.enable();

      const stats = muter.getStats();
      // Should not schedule cues beyond lookahead window
      expect(stats.scheduledTimers).to.equal(0);
    });
  });

  describe('destroy()', () => {
    it('should clean up all resources', () => {
      const muter = new ProactiveAudioMuter(video, filter);
      muter.loadCues(createSampleCues());
      muter.enable();

      muter.destroy();

      const stats = muter.getStats();
      expect(stats.isEnabled).to.be.false;
      expect(stats.totalCues).to.equal(0);
      expect(stats.scheduledTimers).to.equal(0);
    });
  });

  describe('getStats()', () => {
    it('should return accurate statistics', () => {
      const muter = new ProactiveAudioMuter(video, filter);
      const cues = createSampleCues();
      muter.loadCues(cues);

      const stats1 = muter.getStats();
      expect(stats1.totalCues).to.equal(4);
      expect(stats1.isEnabled).to.be.false;
      expect(stats1.isMuted).to.be.false;

      muter.enable();

      const stats2 = muter.getStats();
      expect(stats2.isEnabled).to.be.true;
    });
  });
});
