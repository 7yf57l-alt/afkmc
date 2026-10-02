const { Filter } = require('bad-words');

// Initialize base bad-words filter
const baseFilter = new Filter();

// Comprehensive list of shortforms, slang, and Hinglish/Hindi bad words common on Minecraft servers
const customBadWords = [
  // English shortforms & acronyms
  'stfu', 'wtf', 'wth', 'fck', 'fuk', 'fk', 'mf', 'gtfo', 'kys', 'sob', 'bs', 'ffs',
  'omfg', 'lmfao', 'lmfaoo', 'pos', 'afaik', 'fuq', 'bch', 'fkn', 'fkng', 'fckin',
  'fckn', 'fking', 'b1tch', 'sh!t', 'a$$', 'd1ck', 'n1gga', 'nigga', 'nigger',

  // Hindi / Hinglish profanities & shortforms (common on Indian SMPs)
  'bkl', 'mc', 'bc', 'mkc', 'bkc', 'bsdk', 'bsdika', 'bsdke', 'bhosdike', 'bhosadike',
  'bhosdi', 'chutiya', 'chutiye', 'chutya', 'choot', 'chut', 'lodu', 'loda', 'lauda',
  'lavde', 'lawde', 'gandu', 'gaand', 'gand', 'randi', 'rndi', 'saale', 'sale',
  'kamine', 'kamina', 'harami', 'jhantu', 'jhatu', 'mkl', 'madarchod', 'madarchodh',
  'behenchod', 'behenchodh', 'bhenchod', 'lund', 'lnd', 'tatte', 'tatta', 'madarjaat'
];

// Add custom words to base filter
baseFilter.addWords(...customBadWords);

// Regex list for strict word-boundary matching on shortforms
const shortformRegexes = customBadWords.map(word => {
  // Escape special regex characters
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`, 'gi');
});

/**
 * Clean a string by replacing bad words and shortforms with ***
 * @param {string} text 
 * @returns {string} Cleaned text
 */
function cleanChat(text) {
  if (!text || typeof text !== 'string') return text;

  let cleaned = text;

  // 1. First pass: base bad-words clean
  try {
    cleaned = baseFilter.clean(cleaned);
  } catch {}

  // 2. Second pass: custom shortforms with strict word boundaries
  for (const regex of shortformRegexes) {
    cleaned = cleaned.replace(regex, (match) => '*'.repeat(match.length));
  }

  return cleaned;
}

module.exports = {
  cleanChat,
  customBadWords
};
