/**
 * Simple utility function to immediately invoke a function. It is clearer to
 * read then an IIFE and is named after the `do` keyword in a future ECMAScript
 * proposal.
 *
 * @param f function to immediately invoke
 * @returns the return value of the function
 */
export function due<T>(f: () => T): T {
  return f()
}
