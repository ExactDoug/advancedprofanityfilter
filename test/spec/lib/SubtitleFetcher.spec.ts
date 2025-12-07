/* eslint-disable @typescript-eslint/naming-convention */
import { expect } from 'chai';
import sinon from 'sinon';
import SubtitleFetcher, { SubtitleData } from '@APF/lib/SubtitleFetcher';
import { DOMParser as XMLDOMParser } from '@xmldom/xmldom';

// Polyfill DOMParser for Node.js test environment
if (typeof DOMParser === 'undefined') {
  (global as any).DOMParser = XMLDOMParser;
}

// Sample DFXP content
const sampleDFXP = `<?xml version="1.0" encoding="UTF-8"?>
<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttp="http://www.w3.org/ns/ttml#parameter" ttp:tickRate="10000000" ttp:timeBase="media">
  <body>
    <div>
      <p begin="100000000t" end="200000000t">Test subtitle one</p>
      <p begin="300000000t" end="400000000t">Test subtitle two</p>
    </div>
  </body>
</tt>`;

// Sample IMSC content
const sampleIMSC = `<?xml version="1.0" encoding="UTF-8"?>
<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttp="http://www.w3.org/ns/ttml#parameter" xmlns:imsc="http://www.w3.org/ns/ttml/profile/imsc1.1" ttp:tickRate="10000000">
  <body>
    <div>
      <p begin="100000000t" end="200000000t">IMSC subtitle</p>
    </div>
  </body>
</tt>`;

// Mock Netflix subtitle data
const createMockSubtitleData = (options: {
  hasDFXP?: boolean;
  hasIMSC?: boolean;
  hasWebVTT?: boolean;
  language?: string;
}): SubtitleData => {
  const { hasDFXP = true, hasIMSC = false, hasWebVTT = false, language = 'en' } = options;

  const downloadables: any = {};

  if (hasDFXP) {
    downloadables['dfxp-ls-sdh'] = {
      urls: [{ cdn_id: 1, url: 'https://example.com/subtitle.dfxp' }]
    };
  }

  if (hasIMSC) {
    downloadables['imsc1.1'] = {
      urls: [{ cdn_id: 1, url: 'https://example.com/subtitle.imsc' }]
    };
  }

  if (hasWebVTT) {
    downloadables['webvtt-lssdh-ios8'] = {
      urls: [{ cdn_id: 1, url: 'https://example.com/subtitle.vtt' }]
    };
  }

  return {
    movieId: '80001234',
    timedtexttracks: [
      {
        language,
        rawTrackType: 'closedcaptions',
        isNoneTrack: false,
        ttDownloadables: downloadables
      }
    ]
  };
};

describe('SubtitleFetcher', () => {
  let fetchStub: sinon.SinonStub;

  beforeEach(() => {
    // Clear cache before each test
    SubtitleFetcher.clearCache();

    // Stub global fetch
    fetchStub = sinon.stub(global, 'fetch' as any);
  });

  afterEach(() => {
    // Restore fetch
    fetchStub.restore();
  });

  describe('fetch()', () => {
    it('should fetch and parse DFXP subtitles', async () => {
      const subtitleData = createMockSubtitleData({ hasDFXP: true });

      fetchStub.resolves({
        ok: true,
        text: async () => sampleDFXP
      } as Response);

      const result = await SubtitleFetcher.fetch(subtitleData);

      expect(result.success).to.be.true;
      expect(result.cues.length).to.equal(2);
      expect(result.format).to.equal('dfxp');
      expect(result.language).to.equal('en');
      expect(result.cues[0].text).to.equal('Test subtitle one');
    });

    it('should fallback to IMSC when DFXP fails', async () => {
      const subtitleData = createMockSubtitleData({ hasDFXP: true, hasIMSC: true });

      // First call (DFXP) fails, second call (IMSC) succeeds
      fetchStub
        .onFirstCall()
        .resolves({
          ok: false,
          status: 404
        } as Response)
        .onSecondCall()
        .resolves({
          ok: true,
          text: async () => sampleIMSC
        } as Response);

      const result = await SubtitleFetcher.fetch(subtitleData);

      expect(result.success).to.be.true;
      expect(result.format).to.equal('imsc1.1');
      expect(result.cues.length).to.equal(1);
      expect(result.cues[0].text).to.equal('IMSC subtitle');
    });

    it('should cache fetched subtitles', async () => {
      const subtitleData = createMockSubtitleData({ hasDFXP: true });

      fetchStub.resolves({
        ok: true,
        text: async () => sampleDFXP
      } as Response);

      // First fetch
      const result1 = await SubtitleFetcher.fetch(subtitleData);
      expect(result1.success).to.be.true;
      expect(fetchStub.callCount).to.equal(1);

      // Second fetch should use cache
      const result2 = await SubtitleFetcher.fetch(subtitleData);
      expect(result2.success).to.be.true;
      expect(fetchStub.callCount).to.equal(1); // No additional fetch
      expect(result2.cues.length).to.equal(result1.cues.length);
    });

    it('should respect forceRefetch flag', async () => {
      const subtitleData = createMockSubtitleData({ hasDFXP: true });

      fetchStub.resolves({
        ok: true,
        text: async () => sampleDFXP
      } as Response);

      // First fetch
      await SubtitleFetcher.fetch(subtitleData);
      expect(fetchStub.callCount).to.equal(1);

      // Second fetch with forceRefetch
      await SubtitleFetcher.fetch(subtitleData, 'en', true);
      expect(fetchStub.callCount).to.equal(2); // Should fetch again
    });

    it('should handle missing subtitle track', async () => {
      const subtitleData = createMockSubtitleData({ hasDFXP: true, language: 'fr' });

      const result = await SubtitleFetcher.fetch(subtitleData, 'en'); // Request 'en' but only 'fr' available

      expect(result.success).to.be.false;
      expect(result.error).to.include('No suitable subtitle track found');
    });

    it('should handle all formats failing', async () => {
      const subtitleData = createMockSubtitleData({ hasDFXP: true, hasIMSC: true });

      // All fetches fail
      fetchStub.resolves({
        ok: false,
        status: 404
      } as Response);

      const result = await SubtitleFetcher.fetch(subtitleData);

      expect(result.success).to.be.false;
      expect(result.error).to.include('Failed to fetch or parse subtitles');
    });

    it('should handle fetch errors', async () => {
      const subtitleData = createMockSubtitleData({ hasDFXP: true });

      fetchStub.rejects(new Error('Network error'));

      const result = await SubtitleFetcher.fetch(subtitleData);

      expect(result.success).to.be.false;
      // Should have tried all formats and failed
    });

    it('should handle invalid subtitle content', async () => {
      const subtitleData = createMockSubtitleData({ hasDFXP: true });

      fetchStub.resolves({
        ok: true,
        text: async () => '<invalid>not a valid ttml file</invalid>'
      } as Response);

      const result = await SubtitleFetcher.fetch(subtitleData);

      expect(result.success).to.be.false;
    });

    it('should prefer closedcaptions over subtitles', async () => {
      const subtitleData: SubtitleData = {
        movieId: '80001234',
        timedtexttracks: [
          {
            language: 'en',
            rawTrackType: 'subtitles',
            ttDownloadables: {
              'dfxp-ls-sdh': {
                urls: [{ cdn_id: 1, url: 'https://example.com/subtitle1.dfxp' }]
              }
            }
          },
          {
            language: 'en',
            rawTrackType: 'closedcaptions',
            ttDownloadables: {
              'dfxp-ls-sdh': {
                urls: [{ cdn_id: 1, url: 'https://example.com/subtitle2.dfxp' }]
              }
            }
          }
        ]
      };

      fetchStub.resolves({
        ok: true,
        text: async () => sampleDFXP
      } as Response);

      await SubtitleFetcher.fetch(subtitleData);

      // Should have fetched closedcaptions track (subtitle2.dfxp)
      expect(fetchStub.firstCall.args[0]).to.include('subtitle2.dfxp');
    });

    it('should skip "None" tracks', async () => {
      const subtitleData: SubtitleData = {
        movieId: '80001234',
        timedtexttracks: [
          {
            language: 'en',
            isNoneTrack: true,
            rawTrackType: 'closedcaptions'
          },
          {
            language: 'en',
            rawTrackType: 'closedcaptions',
            ttDownloadables: {
              'dfxp-ls-sdh': {
                urls: [{ cdn_id: 1, url: 'https://example.com/subtitle.dfxp' }]
              }
            }
          }
        ]
      };

      fetchStub.resolves({
        ok: true,
        text: async () => sampleDFXP
      } as Response);

      const result = await SubtitleFetcher.fetch(subtitleData);

      expect(result.success).to.be.true;
      expect(fetchStub.callCount).to.equal(1);
    });
  });

  describe('extractURL()', () => {
    it('should extract URL from array of objects', () => {
      const track = {
        language: 'en',
        ttDownloadables: {
          'dfxp-ls-sdh': {
            urls: [{ cdn_id: 1, url: 'https://example.com/sub.dfxp' }]
          }
        }
      };

      const url = (SubtitleFetcher as any).extractURL(track, 'dfxp-ls-sdh');
      expect(url).to.equal('https://example.com/sub.dfxp');
    });

    it('should extract URL from object with values', () => {
      const track = {
        language: 'en',
        ttDownloadables: {
          'dfxp-ls-sdh': {
            urls: { '1': 'https://example.com/sub.dfxp' }
          }
        }
      };

      const url = (SubtitleFetcher as any).extractURL(track, 'dfxp-ls-sdh');
      expect(url).to.equal('https://example.com/sub.dfxp');
    });

    it('should handle downloadUrls field', () => {
      const track = {
        language: 'en',
        ttDownloadables: {
          'dfxp-ls-sdh': {
            downloadUrls: [{ cdn_id: 1, url: 'https://example.com/sub.dfxp' }]
          }
        }
      };

      const url = (SubtitleFetcher as any).extractURL(track, 'dfxp-ls-sdh');
      expect(url).to.equal('https://example.com/sub.dfxp');
    });

    it('should return null for missing format', () => {
      const track = {
        language: 'en',
        ttDownloadables: {
          'dfxp-ls-sdh': {
            urls: [{ cdn_id: 1, url: 'https://example.com/sub.dfxp' }]
          }
        }
      };

      const url = (SubtitleFetcher as any).extractURL(track, 'imsc1.1');
      expect(url).to.be.null;
    });

    it('should return null for track without downloadables', () => {
      const track = {
        language: 'en'
      };

      const url = (SubtitleFetcher as any).extractURL(track, 'dfxp-ls-sdh');
      expect(url).to.be.null;
    });
  });

  describe('cache management', () => {
    it('should clear cache for specific movie', async () => {
      const subtitleData1 = createMockSubtitleData({ hasDFXP: true });
      const subtitleData2 = { ...subtitleData1, movieId: '80005678' };

      fetchStub.resolves({
        ok: true,
        text: async () => sampleDFXP
      } as Response);

      // Fetch subtitles for two movies
      await SubtitleFetcher.fetch(subtitleData1);
      await SubtitleFetcher.fetch(subtitleData2);

      expect(SubtitleFetcher.isCached('80001234')).to.be.true;
      expect(SubtitleFetcher.isCached('80005678')).to.be.true;

      // Clear cache for first movie only
      SubtitleFetcher.clearCache('80001234');

      expect(SubtitleFetcher.isCached('80001234')).to.be.false;
      expect(SubtitleFetcher.isCached('80005678')).to.be.true;
    });

    it('should clear entire cache', async () => {
      const subtitleData = createMockSubtitleData({ hasDFXP: true });

      fetchStub.resolves({
        ok: true,
        text: async () => sampleDFXP
      } as Response);

      await SubtitleFetcher.fetch(subtitleData);
      expect(SubtitleFetcher.isCached('80001234')).to.be.true;

      SubtitleFetcher.clearCache();
      expect(SubtitleFetcher.isCached('80001234')).to.be.false;
    });

    it('should get cached subtitles', async () => {
      const subtitleData = createMockSubtitleData({ hasDFXP: true });

      fetchStub.resolves({
        ok: true,
        text: async () => sampleDFXP
      } as Response);

      await SubtitleFetcher.fetch(subtitleData);

      const cached = SubtitleFetcher.getCached('80001234', 'en');
      expect(cached).to.not.be.null;
      expect(cached?.success).to.be.true;
      expect(cached?.cues.length).to.equal(2);
    });

    it('should return null for non-cached movie', () => {
      const cached = SubtitleFetcher.getCached('99999999', 'en');
      expect(cached).to.be.null;
    });

    it('should provide cache statistics', async () => {
      const subtitleData = createMockSubtitleData({ hasDFXP: true });

      fetchStub.resolves({
        ok: true,
        text: async () => sampleDFXP
      } as Response);

      const stats1 = SubtitleFetcher.getCacheStats();
      expect(stats1.size).to.equal(0);

      await SubtitleFetcher.fetch(subtitleData);

      const stats2 = SubtitleFetcher.getCacheStats();
      expect(stats2.size).to.equal(1);
      expect(stats2.keys).to.include('80001234-en');
    });
  });
});
