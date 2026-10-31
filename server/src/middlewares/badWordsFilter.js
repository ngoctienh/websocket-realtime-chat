/**
 * Bộ lọc từ ngữ không phù hợp trong môi trường học đường (Tiếng Việt & Tiếng Anh)
 * Tự động thay thế các từ vi phạm bằng dấu "***" trước khi phát lên màn hình chiếu
 */
const DEFAULT_BAD_WORDS = [
  'dm',
  'đm',
  'đkm',
  'dkm',
  'vcl',
  'vl',
  'vkl',
  'cc',
  'clgt',
  'đéo',
  'đệch',
  'địt',
  'lồn',
  'buồi',
  'cặc',
  'chó đẻ',
  'khốn nạn',
  'ngu học',
  'óc chó',
  'fuck',
  'shit',
  'bitch',
  'asshole',
  'bastard'
];

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Tạo biểu thức chính quy khớp nguyên từ (hỗ trợ cả tiếng Việt có dấu nhờ Unicode lookaround)
const BAD_WORD_PATTERNS = DEFAULT_BAD_WORDS.map((word) => {
  const escaped = escapeRegex(word);
  return new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, 'giu');
});

/**
 * Kiểm tra chuỗi có chứa từ ngữ vi phạm hay không
 */
function containsBadWords(text) {
  if (typeof text !== 'string' || !text) return false;
  return BAD_WORD_PATTERNS.some((regex) => {
    regex.lastIndex = 0;
    return regex.test(text);
  });
}

/**
 * Lọc và thay thế từ ngữ vi phạm bằng "***"
 */
function filterBadWords(text) {
  if (typeof text !== 'string' || !text) return '';
  let cleaned = text;
  for (const regex of BAD_WORD_PATTERNS) {
    regex.lastIndex = 0;
    cleaned = cleaned.replace(regex, '***');
  }
  return cleaned;
}

module.exports = {
  DEFAULT_BAD_WORDS,
  containsBadWords,
  filterBadWords
};
