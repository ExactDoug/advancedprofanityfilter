/* eslint-disable @typescript-eslint/naming-convention */
import { expect } from 'chai';
import TTMLParser from '@APF/lib/TTMLParser';
import { DOMParser as XMLDOMParser } from '@xmldom/xmldom';

// Polyfill DOMParser for Node.js test environment
if (typeof DOMParser === 'undefined') {
  (global as any).DOMParser = XMLDOMParser;
}

// Real Netflix DFXP format with tick-based timing
const netflixDFXPSample = `<?xml version="1.0" encoding="UTF-8"?>
<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttp="http://www.w3.org/ns/ttml#parameter" ttp:tickRate="10000000" ttp:timeBase="media">
  <body>
    <div>
      <p begin="101770001t" end="117625006t">
        <span>Test subtitle one</span>
      </p>
      <p begin="255260003t" end="295717505t">
        Bad word here
      </p>
      <p begin="500000000t" end="600000000t">
        <span>Another test subtitle</span>
      </p>
    </div>
  </body>
</tt>`;

// Clock-time format
const clockTimeSample = `<?xml version="1.0" encoding="UTF-8"?>
<tt xmlns="http://www.w3.org/ns/ttml">
  <body>
    <div>
      <p begin="00:00:10.177" end="00:00:11.762">
        First subtitle
      </p>
      <p begin="00:00:25.526" end="00:00:29.571">
        Second subtitle
      </p>
      <p begin="00:01:00.000" end="00:01:05.500">
        Third subtitle
      </p>
    </div>
  </body>
</tt>`;

// IMSC 1.1 format
const imscSample = `<?xml version="1.0" encoding="UTF-8"?>
<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttp="http://www.w3.org/ns/ttml#parameter" xmlns:imsc="http://www.w3.org/ns/ttml/profile/imsc1.1" ttp:tickRate="10000000">
  <body>
    <div>
      <p begin="100000000t" end="200000000t">
        IMSC subtitle
      </p>
    </div>
  </body>
</tt>`;

// Mixed timing formats
const mixedTimingSample = `<?xml version="1.0" encoding="UTF-8"?>
<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttp="http://www.w3.org/ns/ttml#parameter" ttp:tickRate="10000000">
  <body>
    <div>
      <p begin="100000000t" end="200000000t">
        Tick-based
      </p>
      <p begin="00:00:30.000" end="00:00:35.000">
        Clock-based
      </p>
    </div>
  </body>
</tt>`;

// Empty content
const emptySample = `<?xml version="1.0" encoding="UTF-8"?>
<tt xmlns="http://www.w3.org/ns/ttml">
  <body>
    <div>
    </div>
  </body>
</tt>`;

// Invalid timing
const invalidTimingSample = `<?xml version="1.0" encoding="UTF-8"?>
<tt xmlns="http://www.w3.org/ns/ttml">
  <body>
    <div>
      <p begin="invalid" end="00:00:10.000">
        Should be skipped
      </p>
      <p begin="00:00:20.000" end="00:00:25.000">
        Should work
      </p>
    </div>
  </body>
</tt>`;

describe('TTMLParser', () => {
  describe('parse()', () => {
    it('should parse Netflix DFXP with tick-based timing', () => {
      const result = TTMLParser.parse(netflixDFXPSample);

      expect(result.success).to.be.true;
      expect(result.format).to.equal('dfxp');
      expect(result.timingType).to.equal('tick');
      expect(result.cues.length).to.equal(3);

      // Check first cue timing (101770001 ticks / 10000000 = 10.1770001 seconds)
      expect(result.cues[0].startMs).to.be.closeTo(10177, 1);
      expect(result.cues[0].endMs).to.be.closeTo(11762.5, 1);
      expect(result.cues[0].text).to.equal('Test subtitle one');

      // Check second cue
      expect(result.cues[1].startMs).to.be.closeTo(25526, 1);
      expect(result.cues[1].endMs).to.be.closeTo(29571.75, 1);
      expect(result.cues[1].text).to.equal('Bad word here');

      // Check third cue (500000000 ticks / 10000000 = 50 seconds)
      expect(result.cues[2].startMs).to.equal(50000);
      expect(result.cues[2].endMs).to.equal(60000);
      expect(result.cues[2].text).to.equal('Another test subtitle');
    });

    it('should parse clock-time format', () => {
      const result = TTMLParser.parse(clockTimeSample);

      expect(result.success).to.be.true;
      expect(result.format).to.equal('dfxp');
      expect(result.timingType).to.equal('clock');
      expect(result.cues.length).to.equal(3);

      // Check timing conversions
      expect(result.cues[0].startMs).to.equal(10177);
      expect(result.cues[0].endMs).to.equal(11762);
      expect(result.cues[0].text).to.equal('First subtitle');

      expect(result.cues[1].startMs).to.equal(25526);
      expect(result.cues[1].endMs).to.equal(29571);

      // 00:01:00.000 = 60000ms
      expect(result.cues[2].startMs).to.equal(60000);
      expect(result.cues[2].endMs).to.equal(65500);
    });

    it('should detect IMSC 1.1 format', () => {
      const result = TTMLParser.parse(imscSample);

      expect(result.success).to.be.true;
      expect(result.format).to.equal('imsc1.1');
      expect(result.timingType).to.equal('tick');
      expect(result.cues.length).to.equal(1);
      expect(result.cues[0].text).to.equal('IMSC subtitle');
    });

    it('should handle mixed timing formats', () => {
      const result = TTMLParser.parse(mixedTimingSample);

      expect(result.success).to.be.true;
      expect(result.timingType).to.equal('mixed');
      expect(result.warnings).to.include('Mixed timing formats detected (both tick and clock)');
      expect(result.cues.length).to.equal(2);

      // Both should be parsed correctly
      expect(result.cues[0].startMs).to.equal(10000);
      expect(result.cues[1].startMs).to.equal(30000);
    });

    it('should sort cues by start time', () => {
      const unsortedSample = `<?xml version="1.0" encoding="UTF-8"?>
<tt xmlns="http://www.w3.org/ns/ttml">
  <body>
    <div>
      <p begin="00:00:30.000" end="00:00:35.000">Third</p>
      <p begin="00:00:10.000" end="00:00:15.000">First</p>
      <p begin="00:00:20.000" end="00:00:25.000">Second</p>
    </div>
  </body>
</tt>`;

      const result = TTMLParser.parse(unsortedSample);

      expect(result.success).to.be.true;
      expect(result.cues.length).to.equal(3);
      expect(result.cues[0].text).to.equal('First');
      expect(result.cues[1].text).to.equal('Second');
      expect(result.cues[2].text).to.equal('Third');
    });

    it('should handle empty subtitle file', () => {
      const result = TTMLParser.parse(emptySample);

      expect(result.success).to.be.false;
      expect(result.error).to.equal('No subtitle cues found (no <p> elements)');
      expect(result.cues.length).to.equal(0);
    });

    it('should skip invalid timing but continue parsing', () => {
      const result = TTMLParser.parse(invalidTimingSample);

      expect(result.success).to.be.true;
      expect(result.cues.length).to.equal(1);
      expect(result.cues[0].text).to.equal('Should work');
      expect(result.warnings.length).to.be.greaterThan(0);
    });

    it('should handle malformed XML', () => {
      const result = TTMLParser.parse('<not-valid-xml>');

      expect(result.success).to.be.false;
      expect(result.error).to.include('Invalid TTML format');
    });

    it('should handle non-TTML XML', () => {
      const result = TTMLParser.parse('<?xml version="1.0"?><root><item>test</item></root>');

      expect(result.success).to.be.false;
      expect(result.error).to.include('Invalid TTML format');
    });

    it('should extract text from nested spans', () => {
      const nestedSample = `<?xml version="1.0" encoding="UTF-8"?>
<tt xmlns="http://www.w3.org/ns/ttml">
  <body>
    <div>
      <p begin="00:00:10.000" end="00:00:15.000">
        <span>Outer <span>nested</span> text</span>
      </p>
    </div>
  </body>
</tt>`;

      const result = TTMLParser.parse(nestedSample);

      expect(result.success).to.be.true;
      expect(result.cues[0].text).to.equal('Outer nested text');
    });

    it('should normalize whitespace in text', () => {
      const whitespaceSample = `<?xml version="1.0" encoding="UTF-8"?>
<tt xmlns="http://www.w3.org/ns/ttml">
  <body>
    <div>
      <p begin="00:00:10.000" end="00:00:15.000">
        Multiple    spaces
        and   newlines
      </p>
    </div>
  </body>
</tt>`;

      const result = TTMLParser.parse(whitespaceSample);

      expect(result.success).to.be.true;
      expect(result.cues[0].text).to.equal('Multiple spaces and newlines');
    });

    it('should skip cues with empty text', () => {
      const emptyCueSample = `<?xml version="1.0" encoding="UTF-8"?>
<tt xmlns="http://www.w3.org/ns/ttml">
  <body>
    <div>
      <p begin="00:00:10.000" end="00:00:15.000">   </p>
      <p begin="00:00:20.000" end="00:00:25.000">Valid text</p>
    </div>
  </body>
</tt>`;

      const result = TTMLParser.parse(emptyCueSample);

      expect(result.success).to.be.true;
      expect(result.cues.length).to.equal(1);
      expect(result.cues[0].text).to.equal('Valid text');
    });

    it('should skip cues where start >= end', () => {
      const invalidRangeSample = `<?xml version="1.0" encoding="UTF-8"?>
<tt xmlns="http://www.w3.org/ns/ttml">
  <body>
    <div>
      <p begin="00:00:15.000" end="00:00:10.000">Backwards</p>
      <p begin="00:00:20.000" end="00:00:20.000">Same time</p>
      <p begin="00:00:30.000" end="00:00:35.000">Valid</p>
    </div>
  </body>
</tt>`;

      const result = TTMLParser.parse(invalidRangeSample);

      expect(result.success).to.be.true;
      expect(result.cues.length).to.equal(1);
      expect(result.cues[0].text).to.equal('Valid');
    });
  });

  describe('validate()', () => {
    it('should validate valid TTML content', () => {
      const result = TTMLParser.validate(netflixDFXPSample);
      expect(result.isValid).to.be.true;
      expect(result.error).to.be.undefined;
    });

    it('should reject empty content', () => {
      const result = TTMLParser.validate('');
      expect(result.isValid).to.be.false;
      expect(result.error).to.include('empty');
    });

    it('should reject non-string content', () => {
      const result = TTMLParser.validate(null as any);
      expect(result.isValid).to.be.false;
      expect(result.error).to.include('not a string');
    });

    it('should reject content without <tt> element', () => {
      const result = TTMLParser.validate('<xml>not ttml</xml>');
      expect(result.isValid).to.be.false;
      expect(result.error).to.include('no <tt> element');
    });

    it('should reject content without <p> elements', () => {
      const result = TTMLParser.validate('<tt><body><div></div></body></tt>');
      expect(result.isValid).to.be.false;
      expect(result.error).to.include('no <p> elements');
    });
  });

  describe('getCuesInRange()', () => {
    let cues;

    beforeEach(() => {
      const result = TTMLParser.parse(clockTimeSample);
      cues = result.cues;
    });

    it('should find cues overlapping with range', () => {
      // Range 10000-12000 should include first cue (10177-11762)
      const inRange = TTMLParser.getCuesInRange(cues, 10000, 12000);
      expect(inRange.length).to.equal(1);
      expect(inRange[0].text).to.equal('First subtitle');
    });

    it('should find multiple overlapping cues', () => {
      // Range 0-70000 should include all cues
      const inRange = TTMLParser.getCuesInRange(cues, 0, 70000);
      expect(inRange.length).to.equal(3);
    });

    it('should return empty array when no overlap', () => {
      // Range 0-5000 should not include any cues
      const inRange = TTMLParser.getCuesInRange(cues, 0, 5000);
      expect(inRange.length).to.equal(0);
    });

    it('should include partially overlapping cues', () => {
      // Range 11000-26000 should include first two cues
      const inRange = TTMLParser.getCuesInRange(cues, 11000, 26000);
      expect(inRange.length).to.equal(2);
    });
  });

  describe('getCueAtTime()', () => {
    let cues;

    beforeEach(() => {
      const result = TTMLParser.parse(clockTimeSample);
      cues = result.cues;
    });

    it('should find cue active at specific time', () => {
      // 10500ms should be within first cue (10177-11762)
      const cue = TTMLParser.getCueAtTime(cues, 10500);
      expect(cue).to.not.be.null;
      expect(cue?.text).to.equal('First subtitle');
    });

    it('should return null when no cue is active', () => {
      // 5000ms is before any cues
      const cue = TTMLParser.getCueAtTime(cues, 5000);
      expect(cue).to.be.null;
    });

    it('should return null in gap between cues', () => {
      // 15000ms is between first and second cues
      const cue = TTMLParser.getCueAtTime(cues, 15000);
      expect(cue).to.be.null;
    });

    it('should handle time exactly at start', () => {
      // Exactly at start should be included
      const cue = TTMLParser.getCueAtTime(cues, 10177);
      expect(cue).to.not.be.null;
      expect(cue?.text).to.equal('First subtitle');
    });

    it('should handle time exactly at end', () => {
      // Exactly at end should NOT be included (end is exclusive)
      const cue = TTMLParser.getCueAtTime(cues, 11762);
      expect(cue).to.be.null;
    });
  });

  describe('getNextCue()', () => {
    let cues;

    beforeEach(() => {
      const result = TTMLParser.parse(clockTimeSample);
      cues = result.cues;
    });

    it('should find next cue after time', () => {
      // At 5000ms, next cue should be first one at 10177ms
      const nextCue = TTMLParser.getNextCue(cues, 5000);
      expect(nextCue).to.not.be.null;
      expect(nextCue?.text).to.equal('First subtitle');
    });

    it('should find next cue when currently in a cue', () => {
      // At 10500ms (in first cue), next should be second cue
      const nextCue = TTMLParser.getNextCue(cues, 10500);
      expect(nextCue).to.not.be.null;
      expect(nextCue?.text).to.equal('Second subtitle');
    });

    it('should return null when no more cues', () => {
      // After all cues
      const nextCue = TTMLParser.getNextCue(cues, 70000);
      expect(nextCue).to.be.null;
    });

    it('should handle time exactly at cue start', () => {
      // At exactly the start of second cue
      const nextCue = TTMLParser.getNextCue(cues, 25526);
      expect(nextCue).to.not.be.null;
      expect(nextCue?.text).to.equal('Third subtitle');
    });
  });
});
