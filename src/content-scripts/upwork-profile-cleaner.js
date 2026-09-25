(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.HuntExUpworkProfileCleaner = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SECTION_DEFINITIONS = [
    { key: 'about', matches: (line) => line === 'about' || /^about\s+about\b/.test(line) },
    { key: 'client_feedback', matches: (line) => /^client feedback\b/.test(line) },
    { key: 'work_history', matches: (line) => /^work history(?:\s+on upwork)?$/.test(line) },
    { key: 'portfolio', matches: (line) => /^portfolio(?:\s*\(\d+\))?$/.test(line) },
    { key: 'employment_history', matches: (line) => /^employment history$/.test(line) },
    { key: 'skills', matches: (line) => /^skills$/.test(line) },
    { key: 'education', matches: (line) => /^education$/.test(line) },
    { key: 'certifications', matches: (line) => /^certifications?$/.test(line) },
    { key: 'other_experience', matches: (line) => /^other experiences?$/.test(line) },
  ];

  const RAW_SECTION_MARKERS = {
    about: {
      starts: ['About About '],
      ends: ['Work historyWork history', 'PortfolioPortfolio', 'Employment historyEmployment history', 'SkillsSkills', 'Education'],
    },
    portfolio: {
      starts: ['PortfolioPortfolio'],
      ends: ['Employment historyEmployment history', 'SkillsSkills', 'Education'],
    },
    employment_history: {
      starts: ['Employment historyEmployment history'],
      ends: ['SkillsSkills', 'Education'],
    },
    education: {
      starts: ['Education'],
      ends: ['View full profile'],
    },
  };

  const NOISE_PATTERNS = [
    /^back$/i,
    /^close$/i,
    /^close the tooltip/i,
    /^view full profile$/i,
    /^save(?:\s+-\s+.*)?$/i,
    /^hire$/i,
    /^invite$/i,
    /^more options$/i,
    /^take action$/i,
    /^send a message/i,
    /^book a consultation/i,
    /^open for work$/i,
    /^learn more$/i,
    /^show more$/i,
    /^view details$/i,
    /^skip skills$/i,
    /^previous skills/i,
    /^next skills/i,
    /^pagination/i,
    /^current page/i,
    /^go to page/i,
    /^next page$/i,
    /^features\d+%/i,
    /^features-profile-/i,
    /^features-action-/i,
    /^features-navbar/i,
    /^proposals have a new look/i,
    /^a new way to navigate/i,
    /^jump to specific parts/i,
    /^this skill is relevant to your search\.?$/i,
    /^search related$/i,
    /^completed jobs$/i,
    /^in progress$/i,
    /^summary$/i,
    /^skills used$/i,
  ];

  function normalizeInline(value) {
    return String(value || '')
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function normalizeLines(lines) {
    const normalized = [];
    for (const value of Array.isArray(lines) ? lines : []) {
      const line = normalizeInline(value);
      if (!line || isNoise(line)) continue;
      if (normalized[normalized.length - 1] === line) continue;
      normalized.push(line);
    }
    return normalized;
  }

  function isNoise(line) {
    return NOISE_PATTERNS.some((pattern) => pattern.test(line));
  }

  function unique(values, limit = Infinity) {
    const result = [];
    const seen = new Set();
    for (const value of values || []) {
      const normalized = normalizeInline(value);
      const key = normalized.toLocaleLowerCase();
      if (!normalized || seen.has(key)) continue;
      seen.add(key);
      result.push(normalized);
      if (result.length >= limit) break;
    }
    return result;
  }

  function truncate(value, maxChars) {
    const text = normalizeInline(value);
    if (text.length <= maxChars) return text;
    const cut = text.slice(0, maxChars);
    const boundary = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('; '), cut.lastIndexOf(' | '));
    return `${cut.slice(0, boundary > maxChars * 0.7 ? boundary + 1 : maxChars).trim()}…`;
  }

  function locateStructuredSections(lines) {
    const starts = {};
    for (let i = 0; i < lines.length; i++) {
      const canonical = lines[i].toLocaleLowerCase();
      for (const definition of SECTION_DEFINITIONS) {
        if (definition.matches(canonical)) starts[definition.key] = i;
      }
    }

    const sections = {};
    const orderedStarts = Object.values(starts).sort((a, b) => a - b);
    for (const [key, start] of Object.entries(starts)) {
      const end = orderedStarts.find((index) => index > start) ?? lines.length;
      sections[key] = normalizeLines(lines.slice(start + 1, end));
    }
    return sections;
  }

  function findLastMarker(text, markers) {
    let best = null;
    for (const marker of markers) {
      const index = text.lastIndexOf(marker);
      if (index >= 0 && (!best || index > best.index)) best = { index, marker };
    }
    return best;
  }

  function extractRawSection(rawText, key) {
    const config = RAW_SECTION_MARKERS[key];
    if (!config) return '';
    const start = findLastMarker(rawText, config.starts);
    if (!start) return '';

    const contentStart = start.index + start.marker.length;
    let contentEnd = rawText.length;
    for (const marker of config.ends) {
      const index = rawText.indexOf(marker, contentStart);
      if (index >= 0 && index < contentEnd) contentEnd = index;
    }
    return rawText.slice(contentStart, contentEnd);
  }

  function cleanSection(lines, rawFallback, maxChars) {
    const structured = normalizeLines(lines).join(' | ');
    const source = structured || rawFallback;
    return truncate(
      source
        .replace(/Close the tooltip/gi, ' ')
        .replace(/This skill is relevant to your search\.?/gi, ' ')
        .replace(/Show more/gi, ' ')
        .replace(/View details/gi, ' '),
      maxChars
    );
  }

  function cleanWorkTitle(line) {
    return normalizeInline(line)
      .replace(/\s+Rating is [\s\S]*$/i, '')
      .replace(/\s+\$[\d,.]+[\s\S]*$/i, '')
      .replace(/\s+Fixed price[\s\S]*$/i, '')
      .replace(/\s+Hourly[\s\S]*$/i, '')
      .trim();
  }

  function extractWorkTitles(lines, skillSet) {
    const excluded = /^(?:job description|generated by|a top-performing|show you.re a match|new$)/i;
    const dateOrMetric = /(?:\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b.*\b\d{4}\b|\bhours?\b|\bjob success\b)/i;
    const candidates = [];
    for (const rawLine of normalizeLines(lines)) {
      const title = cleanWorkTitle(rawLine);
      const key = title.toLocaleLowerCase();
      if (title.length < 5 || title.length > 180 || /^\$[\d,.]+/.test(title)) continue;
      if (excluded.test(title) || dateOrMetric.test(title) || skillSet.has(key)) continue;
      candidates.push(title);
    }
    return unique(candidates, 12);
  }

  function cleanLinks(links) {
    const result = [];
    const seen = new Set();
    for (const link of links || []) {
      const url = normalizeInline(link?.url);
      if (!url || seen.has(url)) continue;
      seen.add(url);
      result.push({
        label: truncate(link?.label || '', 120) || null,
        url,
      });
      if (result.length >= 15) break;
    }
    return result;
  }

  function compactObject(value) {
    if (Array.isArray(value)) return value.length ? value : undefined;
    if (!value || typeof value !== 'object') return value || undefined;
    const result = {};
    for (const [key, child] of Object.entries(value)) {
      const compacted = compactObject(child);
      if (compacted !== undefined) result[key] = compacted;
    }
    return Object.keys(result).length ? result : undefined;
  }

  function cleanUpworkProfileData({ rawText, structuredLines, identity, skills, externalLinks }) {
    const raw = normalizeInline(rawText);
    const lines = normalizeLines(structuredLines);
    const sections = locateStructuredSections(lines);
    const cleanedSkills = unique(
      (skills || []).filter((skill) => {
        const normalized = normalizeInline(skill);
        return normalized && normalized.length <= 100 && !isNoise(normalized);
      }),
      30
    );
    const skillSet = new Set(cleanedSkills.map((skill) => skill.toLocaleLowerCase()));

    const about = cleanSection(sections.about, extractRawSection(raw, 'about'), 3000);
    const portfolio = cleanSection(sections.portfolio, extractRawSection(raw, 'portfolio'), 2500);
    const employment = cleanSection(
      sections.employment_history,
      extractRawSection(raw, 'employment_history'),
      1200
    );
    const education = cleanSection(sections.education, extractRawSection(raw, 'education'), 900);

    return compactObject({
      schema_version: 1,
      identity: {
        display_name: truncate(identity?.displayName, 160),
        headline: truncate(identity?.headline, 300),
        location: truncate(identity?.location, 160),
      },
      about,
      portfolio,
      employment_history: employment,
      work_history_titles: extractWorkTitles(sections.work_history, skillSet),
      education,
      certifications: cleanSection(sections.certifications, '', 800),
      other_experience: cleanSection(sections.other_experience, '', 800),
      skills: cleanedSkills,
      external_links: cleanLinks(externalLinks),
    });
  }

  return { cleanUpworkProfileData };
});
