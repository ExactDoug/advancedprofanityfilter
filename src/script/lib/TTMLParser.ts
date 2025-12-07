/**
 * TTML/DFXP/IMSC 1.1 Subtitle Parser for Netflix and other streaming services
 *
 * Supports:
 * - DFXP (Distribution Format Exchange Profile) - Netflix primary format
 * - IMSC 1.1 (MPEG IMSC) - Netflix secondary format for Japanese and future expansion
 * - Tick-based timing (e.g., "101770001t" with tickRate="10000000")
 * - Clock-time timing (e.g., "00:00:10.177" in HH:MM:SS.mmm format)
 */

export interface SubtitleCue {
  /** Start time in milliseconds */
  startMs: number;
  /** End time in milliseconds */
  endMs: number;
  /** Subtitle text content (HTML stripped) */
  text: string;
  /** Original text with HTML (for debugging) */
  originalText?: string;
}

export interface ParseResult {
  /** Successfully parsed subtitle cues */
  cues: SubtitleCue[];
  /** Format detected (dfxp, imsc1.1, or ttml) */
  format: string;
  /** Timing type detected (tick or clock) */
  timingType: 'tick' | 'clock' | 'mixed';
  /** Any warnings encountered during parsing */
  warnings: string[];
  /** Whether parsing was successful */
  success: boolean;
  /** Error message if parsing failed */
  error?: string;
}

export default class TTMLParser {
  /**
   * Parse TTML/DFXP/IMSC 1.1 subtitle content
   * @param xmlContent - Raw XML content from subtitle file
   * @returns ParseResult with cues and metadata
   */
  static parse(xmlContent: string): ParseResult {
    const result: ParseResult = {
      cues: [],
      format: 'unknown',
      timingType: 'clock',
      warnings: [],
      success: false,
    };

    try {
      // Parse XML using native DOMParser
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(xmlContent, 'text/xml');

      // Check for XML parsing errors
      const parserErrors = xmlDoc.getElementsByTagName('parsererror');
      if (parserErrors.length > 0) {
        result.error = `XML parsing failed: ${parserErrors[0].textContent}`;
        return result;
      }

      // Detect format from root element and namespaces
      const rootElement = xmlDoc.documentElement;
      const rootName = rootElement.localName || rootElement.nodeName;

      if (rootName !== 'tt') {
        result.error = `Invalid TTML format: expected <tt> root element, found <${rootName}>`;
        return result;
      }

      // Detect format from namespace or attributes
      // Check both main xmlns and xmlns:* attributes for IMSC
      let isIMSC = false;
      const xmlns = rootElement.getAttribute('xmlns');
      if (xmlns?.includes('imsc')) {
        isIMSC = true;
      }

      // Check all attributes for xmlns:imsc
      if (rootElement.attributes) {
        for (let i = 0; i < rootElement.attributes.length; i++) {
          const attr = rootElement.attributes[i];
          if (attr.name.includes('imsc') || attr.value.includes('imsc')) {
            isIMSC = true;
            break;
          }
        }
      }

      result.format = isIMSC ? 'imsc1.1' : 'dfxp';

      // Extract timing parameters
      const tickRate = this.getTickRate(rootElement);
      const timeBase = rootElement.getAttribute('ttp:timeBase') ||
                       rootElement.getAttribute('timeBase') ||
                       'media';

      // Find all subtitle cue elements (<p> tags)
      const pElements = xmlDoc.getElementsByTagName('p');

      if (pElements.length === 0) {
        result.error = 'No subtitle cues found (no <p> elements)';
        return result;
      }

      let hasTickTiming = false;
      let hasClockTiming = false;

      // Parse each cue
      for (let index = 0; index < pElements.length; index++) {
        const pElement = pElements[index];
        try {
          const beginAttr = pElement.getAttribute('begin');
          const endAttr = pElement.getAttribute('end');

          if (!beginAttr || !endAttr) {
            result.warnings.push(`Cue ${index}: missing begin or end attribute, skipping`);
            continue;
          }

          // Detect timing type
          if (beginAttr.endsWith('t')) {
            hasTickTiming = true;
          } else {
            hasClockTiming = true;
          }

          // Parse start and end times
          const startMs = this.parseTime(beginAttr, tickRate);
          const endMs = this.parseTime(endAttr, tickRate);

          if (startMs === null || endMs === null) {
            result.warnings.push(`Cue ${index}: could not parse time "${beginAttr}" -> "${endAttr}", skipping`);
            continue;
          }

          if (startMs >= endMs) {
            result.warnings.push(`Cue ${index}: start time >= end time (${startMs} >= ${endMs}), skipping`);
            continue;
          }

          // Extract text content (strip HTML but preserve text)
          const text = this.extractText(pElement);
          const originalText = pElement.innerHTML;

          if (!text.trim()) {
            result.warnings.push(`Cue ${index}: empty text content, skipping`);
            continue;
          }

          result.cues.push({
            startMs,
            endMs,
            text: text.trim(),
            originalText,
          });
        } catch (error) {
          result.warnings.push(`Cue ${index}: parsing error - ${error.message}`);
        }
      }

      // Determine timing type
      if (hasTickTiming && hasClockTiming) {
        result.timingType = 'mixed';
        result.warnings.push('Mixed timing formats detected (both tick and clock)');
      } else if (hasTickTiming) {
        result.timingType = 'tick';
      } else {
        result.timingType = 'clock';
      }

      // Sort cues by start time
      result.cues.sort((a, b) => a.startMs - b.startMs);

      result.success = result.cues.length > 0;
      if (!result.success) {
        result.error = 'No valid subtitle cues could be parsed';
      }

      return result;
    } catch (error) {
      result.error = `Unexpected parsing error: ${error.message}`;
      return result;
    }
  }

  /**
   * Extract tick rate from TTML root element
   * @param rootElement - The <tt> root element
   * @returns Tick rate (ticks per second), or null if not using tick-based timing
   */
  private static getTickRate(rootElement: Element): number | null {
    const tickRateAttr = rootElement.getAttribute('ttp:tickRate') ||
                         rootElement.getAttribute('tickRate');

    if (!tickRateAttr) {
      return null;
    }

    const tickRate = parseInt(tickRateAttr, 10);
    if (isNaN(tickRate) || tickRate <= 0) {
      return null;
    }

    return tickRate;
  }

  /**
   * Parse time string in either tick-based or clock-time format
   * @param timeStr - Time string (e.g., "101770001t" or "00:00:10.177")
   * @param tickRate - Tick rate for tick-based timing (ticks per second)
   * @returns Time in milliseconds, or null if parsing fails
   */
  private static parseTime(timeStr: string, tickRate: number | null): number | null {
    if (!timeStr) {
      return null;
    }

    try {
      // Tick-based format: "101770001t"
      if (timeStr.endsWith('t')) {
        if (tickRate === null || tickRate <= 0) {
          return null; // Can't parse tick-based time without valid tick rate
        }

        const ticks = parseFloat(timeStr.slice(0, -1));
        if (isNaN(ticks)) {
          return null;
        }

        // Convert ticks to milliseconds
        const seconds = ticks / tickRate;
        return seconds * 1000;
      }

      // Clock-time format: "HH:MM:SS.mmm" or "HH:MM:SS"
      const clockMatch = timeStr.match(/^(\d{1,2}):(\d{2}):(\d{2})\.?(\d{1,3})?$/);
      if (clockMatch) {
        const hours = parseInt(clockMatch[1], 10);
        const minutes = parseInt(clockMatch[2], 10);
        const seconds = parseInt(clockMatch[3], 10);
        const milliseconds = clockMatch[4] ? parseInt(clockMatch[4].padEnd(3, '0'), 10) : 0;

        return (hours * 3600 + minutes * 60 + seconds) * 1000 + milliseconds;
      }

      // Fractional seconds format: "123.456s"
      const secondsMatch = timeStr.match(/^(\d+(?:\.\d+)?)s?$/);
      if (secondsMatch) {
        const seconds = parseFloat(secondsMatch[1]);
        if (!isNaN(seconds)) {
          return seconds * 1000;
        }
      }

      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Extract plain text from a subtitle element (strip HTML tags)
   * @param element - The <p> element containing subtitle text
   * @returns Plain text content
   */
  private static extractText(element: Element): string {
    // Get text content recursively from element and all children
    // This handles nested <span> elements and other markup
    const text = element.textContent || '';

    // Clean up whitespace
    return text
      .replace(/\s+/g, ' ')  // Collapse multiple spaces
      .replace(/\n+/g, ' ')  // Replace newlines with spaces
      .trim();
  }

  /**
   * Validate TTML content before parsing
   * @param xmlContent - Raw XML content
   * @returns Object with isValid flag and optional error message
   */
  static validate(xmlContent: string): { isValid: boolean; error?: string } {
    if (!xmlContent || typeof xmlContent !== 'string') {
      return { isValid: false, error: 'Content is empty or not a string' };
    }

    if (!xmlContent.includes('<tt')) {
      return { isValid: false, error: 'Not a TTML document (no <tt> element found)' };
    }

    if (!xmlContent.includes('<p')) {
      return { isValid: false, error: 'No subtitle cues found (no <p> elements)' };
    }

    return { isValid: true };
  }

  /**
   * Get cues that overlap with a specific time range
   * @param cues - Array of subtitle cues
   * @param startMs - Start time in milliseconds
   * @param endMs - End time in milliseconds
   * @returns Cues that overlap with the specified range
   */
  static getCuesInRange(cues: SubtitleCue[], startMs: number, endMs: number): SubtitleCue[] {
    return cues.filter(cue => {
      // Check if cue overlaps with range
      return cue.startMs < endMs && cue.endMs > startMs;
    });
  }

  /**
   * Get the cue active at a specific time
   * @param cues - Array of subtitle cues
   * @param timeMs - Time in milliseconds
   * @returns Active cue, or null if no cue is active
   */
  static getCueAtTime(cues: SubtitleCue[], timeMs: number): SubtitleCue | null {
    return cues.find(cue => cue.startMs <= timeMs && cue.endMs > timeMs) || null;
  }

  /**
   * Find the next cue after a specific time
   * @param cues - Array of subtitle cues (must be sorted by startMs)
   * @param timeMs - Time in milliseconds
   * @returns Next cue, or null if no cue follows
   */
  static getNextCue(cues: SubtitleCue[], timeMs: number): SubtitleCue | null {
    return cues.find(cue => cue.startMs > timeMs) || null;
  }
}
