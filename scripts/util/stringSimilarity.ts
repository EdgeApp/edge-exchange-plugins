/**
 * Calculate Levenshtein distance between two strings
 * Returns a number between 0 (identical) and max(str1.length, str2.length) (completely different)
 */
function levenshteinDistance(str1: string, str2: string): number {
  const len1 = str1.length
  const len2 = str2.length
  const matrix: number[][] = []

  // Initialize matrix
  for (let i = 0; i <= len1; i++) {
    matrix[i] = [i]
  }
  for (let j = 0; j <= len2; j++) {
    matrix[0][j] = j
  }

  // Fill matrix
  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      if (str1[i - 1] === str2[j - 1]) {
        matrix[i][j] = matrix[i - 1][j - 1]
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1, // deletion
          matrix[i][j - 1] + 1, // insertion
          matrix[i - 1][j - 1] + 1 // substitution
        )
      }
    }
  }

  return matrix[len1][len2]
}

/**
 * Calculate similarity score between two strings (0 = identical, 1 = completely different)
 * Uses Levenshtein distance normalized by the maximum length
 */
export function similarity(str1: string, str2: string): number {
  const maxLen = Math.max(str1.length, str2.length)
  if (maxLen === 0) return 0
  return levenshteinDistance(str1.toLowerCase(), str2.toLowerCase()) / maxLen
}

/**
 * Find similar strings in a list, sorted by similarity (most similar first)
 */
export interface SimilarityMatch {
  value: string
  similarity: number
}

export function findSimilar(
  target: string,
  candidates: string[],
  maxResults: number = 10,
  maxSimilarity: number = 0.5
): SimilarityMatch[] {
  const matches: SimilarityMatch[] = candidates
    .map(candidate => ({
      value: candidate,
      similarity: similarity(target, candidate)
    }))
    .filter(match => match.similarity <= maxSimilarity)
    .sort((a, b) => a.similarity - b.similarity)
    .slice(0, maxResults)

  return matches
}
